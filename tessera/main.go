package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type Config struct {
	Port       string
	Origin     string
	StorageDir string
}

type Server struct {
	cfg        Config
	mu         sync.RWMutex
	leaves     [][]byte
	pubKey     ed25519.PublicKey
	privKey    ed25519.PrivateKey
	leavesFile *os.File
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3500"
	}
	origin := os.Getenv("ORIGIN")
	if origin == "" {
		origin = "fedra.audit.log"
	}
	storageDir := os.Getenv("STORAGE_DIR")
	if storageDir == "" {
		storageDir = "/data"
	}

	cfg := Config{
		Port:       port,
		Origin:     origin,
		StorageDir: storageDir,
	}

	srv, err := newServer(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize Tessera server: %v", err)
	}
	defer srv.close()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", srv.handleHealth)
	mux.HandleFunc("/add", srv.handleAdd)
	mux.HandleFunc("/checkpoint", srv.handleCheckpoint)
	mux.HandleFunc("/proof", srv.handleProof)
	mux.HandleFunc("/leaf", srv.handleLeaf)
	mux.HandleFunc("/pubkey", srv.handlePubKey)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("FEDRA Tessera Transparency Log starting on %s (origin: %s, storage: %s)", addr, origin, storageDir)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server exited: %v", err)
	}
}

func newServer(cfg Config) (*Server, error) {
	if err := os.MkdirAll(cfg.StorageDir, 0755); err != nil {
		return nil, fmt.Errorf("mkdir storage_dir: %w", err)
	}

	// 1. Initialize or load Ed25519 key pair
	privKey, pubKey, err := loadOrGenKey(cfg.StorageDir)
	if err != nil {
		return nil, fmt.Errorf("load/gen key: %w", err)
	}

	// 2. Open or create leaves binary storage
	leavesPath := filepath.Join(cfg.StorageDir, "leaves.bin")
	f, err := os.OpenFile(leavesPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("open leaves file: %w", err)
	}

	// 3. Read existing leaves
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("stat leaves file: %w", err)
	}

	var leaves [][]byte
	if info.Size() > 0 {
		data, err := os.ReadFile(leavesPath)
		if err != nil {
			f.Close()
			return nil, fmt.Errorf("read existing leaves: %w", err)
		}
		if len(data)%32 != 0 {
			log.Printf("[WARN] leaves.bin size (%d) not divisible by 32, truncating corrupted partial leaf", len(data))
			data = data[:len(data)-(len(data)%32)]
		}
		for i := 0; i < len(data); i += 32 {
			leaf := make([]byte, 32)
			copy(leaf, data[i:i+32])
			leaves = append(leaves, leaf)
		}
		log.Printf("Restored %d leaves from persistent storage %s", len(leaves), leavesPath)
	}

	return &Server{
		cfg:        cfg,
		leaves:     leaves,
		pubKey:     pubKey,
		privKey:    privKey,
		leavesFile: f,
	}, nil
}

func (s *Server) close() {
	if s.leavesFile != nil {
		s.leavesFile.Close()
	}
}

func loadOrGenKey(dir string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	privPath := filepath.Join(dir, "ed25519.priv")
	pubPath := filepath.Join(dir, "ed25519.pub")

	// Check if provided via env var
	envPriv := os.Getenv("ED25519_PRIVATE_KEY")
	if envPriv != "" {
		raw, err := hex.DecodeString(strings.TrimSpace(envPriv))
		if err == nil && len(raw) == ed25519.PrivateKeySize {
			priv := ed25519.PrivateKey(raw)
			pub := priv.Public().(ed25519.PublicKey)
			return priv, pub, nil
		}
	}

	if privBytes, err := os.ReadFile(privPath); err == nil && len(privBytes) == ed25519.PrivateKeySize {
		priv := ed25519.PrivateKey(privBytes)
		pub := priv.Public().(ed25519.PublicKey)
		return priv, pub, nil
	}

	// Generate fresh key
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}

	if err := os.WriteFile(privPath, priv, 0600); err != nil {
		log.Printf("[WARN] Could not persist private key to %s: %v", privPath, err)
	}
	if err := os.WriteFile(pubPath, pub, 0644); err != nil {
		log.Printf("[WARN] Could not persist public key to %s: %v", pubPath, err)
	}

	return priv, pub, nil
}

// =========================================================================
// RFC 6962 Merkle Tree Implementation
// =========================================================================

func leafHash(leaf []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0x00})
	h.Write(leaf)
	return h.Sum(nil)
}

func nodeHash(left, right []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0x01})
	h.Write(left)
	h.Write(right)
	return h.Sum(nil)
}

func largestPowerOf2LessThan(n int64) int64 {
	k := int64(1)
	for k*2 < n {
		k *= 2
	}
	return k
}

func mth(leaves [][]byte) []byte {
	n := int64(len(leaves))
	if n == 0 {
		empty := sha256.Sum256([]byte{})
		return empty[:]
	}
	if n == 1 {
		return leafHash(leaves[0])
	}
	k := largestPowerOf2LessThan(n)
	left := mth(leaves[:k])
	right := mth(leaves[k:])
	return nodeHash(left, right)
}

func getProof(m int64, leaves [][]byte) [][]byte {
	n := int64(len(leaves))
	if n <= 1 {
		return nil
	}
	k := largestPowerOf2LessThan(n)
	if m < k {
		sub := getProof(m, leaves[:k])
		right := mth(leaves[k:])
		return append(sub, right)
	}
	sub := getProof(m-k, leaves[k:])
	left := mth(leaves[:k])
	return append(sub, left)
}

func (s *Server) buildSignedCheckpoint(root []byte, size int64) string {
	rootB64 := base64.StdEncoding.EncodeToString(root)
	body := fmt.Sprintf("%s\n%d\n%s\n\n", s.cfg.Origin, size, rootB64)
	sig := ed25519.Sign(s.privKey, []byte(body))
	sigB64 := base64.StdEncoding.EncodeToString(sig)
	return fmt.Sprintf("%s— %s %s\n", body, s.cfg.Origin, sigB64)
}

// =========================================================================
// HTTP Endpoints
// =========================================================================

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	size := len(s.leaves)
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "healthy",
		"tree_size":  size,
		"origin":     s.cfg.Origin,
		"public_key": hex.EncodeToString(s.pubKey),
	})
}

func (s *Server) handlePubKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"origin":            s.cfg.Origin,
		"public_key_hex":    hex.EncodeToString(s.pubKey),
		"public_key_base64": base64.StdEncoding.EncodeToString(s.pubKey),
	})
}

type AddRequest struct {
	LeafHash string `json:"leaf_hash"`
	Data     string `json:"data"`
}

func (s *Server) handleAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req AddRequest
	if err := json.Unmarshal(body, &req); err != nil {
		// Fallback: accept raw hex string
		req.LeafHash = strings.TrimSpace(string(body))
	}

	targetHashStr := req.LeafHash
	if targetHashStr == "" && req.Data != "" {
		targetHashStr = req.Data
	}
	targetHashStr = strings.TrimPrefix(targetHashStr, "0x")

	rawHash, err := hex.DecodeString(targetHashStr)
	if err != nil || len(rawHash) != 32 {
		http.Error(w, "leaf_hash must be a 32-byte hex string (64 characters)", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Append to persistent leaves file
	if _, err := s.leavesFile.Write(rawHash); err != nil {
		http.Error(w, "Failed to persist leaf: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := s.leavesFile.Sync(); err != nil {
		http.Error(w, "Failed to sync leaf to disk: "+err.Error(), http.StatusInternalServerError)
		return
	}

	logIndex := int64(len(s.leaves))
	s.leaves = append(s.leaves, rawHash)
	treeSize := int64(len(s.leaves))

	root := mth(s.leaves)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"log_index":      logIndex,
		"tree_size":      treeSize,
		"root_hash":      hex.EncodeToString(root),
		"canonical_hash": hex.EncodeToString(rawHash),
	})
}

func (s *Server) handleCheckpoint(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	size := int64(len(s.leaves))
	root := mth(s.leaves)
	s.mu.RUnlock()

	checkpointNote := s.buildSignedCheckpoint(root, size)

	format := r.URL.Query().Get("format")
	acceptHeader := r.Header.Get("Accept")
	if format == "json" || strings.Contains(acceptHeader, "application/json") {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"origin":            s.cfg.Origin,
			"tree_size":         size,
			"root_hash":         hex.EncodeToString(root),
			"root_hash_base64":  base64.StdEncoding.EncodeToString(root),
			"checkpoint":        checkpointNote,
			"public_key_hex":    hex.EncodeToString(s.pubKey),
			"public_key_base64": base64.StdEncoding.EncodeToString(s.pubKey),
		})
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(checkpointNote))
}

func (s *Server) handleProof(w http.ResponseWriter, r *http.Request) {
	idxStr := r.URL.Query().Get("index")
	if idxStr == "" {
		http.Error(w, "Missing index parameter", http.StatusBadRequest)
		return
	}
	idx, err := strconv.ParseInt(idxStr, 10, 64)
	if err != nil || idx < 0 {
		http.Error(w, "Invalid index parameter", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	size := int64(len(s.leaves))
	if idx >= size {
		s.mu.RUnlock()
		http.Error(w, fmt.Sprintf("index %d out of bounds for tree_size %d", idx, size), http.StatusBadRequest)
		return
	}

	leaf := s.leaves[idx]
	proofHashes := getProof(idx, s.leaves)
	root := mth(s.leaves)
	s.mu.RUnlock()

	checkpointNote := s.buildSignedCheckpoint(root, size)

	var proofHex []string
	for _, p := range proofHashes {
		proofHex = append(proofHex, hex.EncodeToString(p))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"leaf_index":        idx,
		"tree_size":         size,
		"leaf_hash":         hex.EncodeToString(leaf),
		"root_hash":         hex.EncodeToString(root),
		"root_hash_base64":  base64.StdEncoding.EncodeToString(root),
		"inclusion_proof":   proofHex,
		"checkpoint":        checkpointNote,
		"origin":            s.cfg.Origin,
		"public_key_hex":    hex.EncodeToString(s.pubKey),
		"public_key_base64": base64.StdEncoding.EncodeToString(s.pubKey),
	})
}

func (s *Server) handleLeaf(w http.ResponseWriter, r *http.Request) {
	idxStr := r.URL.Query().Get("index")
	idx, err := strconv.ParseInt(idxStr, 10, 64)
	if err != nil || idx < 0 {
		http.Error(w, "Invalid index", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if idx >= int64(len(s.leaves)) {
		http.Error(w, "Index out of range", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"index":     idx,
		"leaf_hash": hex.EncodeToString(s.leaves[idx]),
	})
}

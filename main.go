package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
)

type Room struct {
	ID           string
	Players      map[string]*websocket.Conn
	PlanesPlaced map[string]int
	PlayerGrids  map[string][]bool
	PlaneHeads   map[string][]int // New: Track plane head positions
	HeadHits     map[string]int   // New: Track number of head hits
	ReadyPlayers map[string]bool
	mu           sync.Mutex
}

type GameServer struct {
	rooms map[string]*Room
	mu    sync.Mutex
}

type Message struct {
	Type           string          `json:"type"`
	RoomID         string          `json:"roomId,omitempty"`
	PlayerID       string          `json:"playerId,omitempty"`
	Data           json.RawMessage `json:"data,omitempty"`
	Position       int             `json:"position,omitempty"`
	IsHit          bool            `json:"isHit,omitempty"`
	IsHeadHit      bool            `json:"isHeadHit,omitempty"` // New field
	HeadHits       int             `json:"headHits,omitempty"`  // New field
	GameOver       bool            `json:"gameOver,omitempty"`  // New field
	Winner         string          `json:"winner,omitempty"`    // New field
	PlanesPlaced   int             `json:"planesPlaced,omitempty"`
	OpponentReady  bool            `json:"opponentReady,omitempty"`
	PlacementPhase bool            `json:"placementPhase,omitempty"`
	MyTurn         bool            `json:"myTurn,omitempty"`
	Positions      []int           `json:"positions,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func NewGameServer() *GameServer {
	return &GameServer{
		rooms: make(map[string]*Room),
	}
}

func (gs *GameServer) createRoom() string {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	roomID := fmt.Sprintf("room_%d", len(gs.rooms)+1)
	gs.rooms[roomID] = &Room{
		ID:           roomID,
		Players:      make(map[string]*websocket.Conn),
		PlanesPlaced: make(map[string]int),
		PlayerGrids:  make(map[string][]bool),
		PlaneHeads:   make(map[string][]int), // New
		HeadHits:     make(map[string]int),   // New
		ReadyPlayers: make(map[string]bool),
	}
	return roomID
}

func getOtherPlayerID(playerID string) string {
	if playerID == "1" {
		return "2"
	}
	return "1"
}

func (gs *GameServer) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	var currentRoom *Room
	var currentPlayerID string

	for {
		var msg Message
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Printf("Read error: %v", err)
			break
		}

		switch msg.Type {
		case "create_room":
			roomID := gs.createRoom()
			currentRoom = gs.rooms[roomID]
			currentPlayerID = "1"

			currentRoom.mu.Lock()
			currentRoom.Players["1"] = conn
			currentRoom.PlanesPlaced["1"] = 0
			currentRoom.PlayerGrids["1"] = make([]bool, 100)
			currentRoom.ReadyPlayers["1"] = false
			currentRoom.mu.Unlock()

			err = conn.WriteJSON(Message{
				Type:           "room_created",
				RoomID:         roomID,
				PlayerID:       "1",
				PlacementPhase: true,
				PlanesPlaced:   0,
			})
			if err != nil {
				log.Printf("Write error: %v", err)
			}

		case "join_room":
			room, exists := gs.rooms[msg.RoomID]
			if !exists {
				conn.WriteJSON(Message{
					Type: "error",
					Data: json.RawMessage(`"Room not found"`),
				})
				continue
			}

			room.mu.Lock()
			if len(room.Players) >= 2 {
				conn.WriteJSON(Message{
					Type: "error",
					Data: json.RawMessage(`"Room is full"`),
				})
				room.mu.Unlock()
				continue
			}

			currentPlayerID = "2"
			currentRoom = room
			room.Players["2"] = conn
			room.PlanesPlaced["2"] = 0
			room.PlayerGrids["2"] = make([]bool, 100)
			room.ReadyPlayers["2"] = false

			// Notify both players
			for pid, player := range room.Players {
				player.WriteJSON(Message{
					Type:           "game_start",
					PlayerID:       pid,
					PlacementPhase: true,
					PlanesPlaced:   room.PlanesPlaced[pid],
				})
			}
			room.mu.Unlock()

		case "place_plane":
			if currentRoom == nil {
				continue
			}

			currentRoom.mu.Lock()
			// Update the planes placed count
			currentRoom.PlanesPlaced[currentPlayerID] = msg.PlanesPlaced

			if len(msg.Positions) > 0 {
				if currentRoom.PlaneHeads[currentPlayerID] == nil {
					currentRoom.PlaneHeads[currentPlayerID] = make([]int, 0)
				}
				currentRoom.PlaneHeads[currentPlayerID] = append(
					currentRoom.PlaneHeads[currentPlayerID],
					msg.Positions[0],
				)

				// Update grid
				for _, pos := range msg.Positions {
					if pos >= 0 && pos < 100 {
						currentRoom.PlayerGrids[currentPlayerID][pos] = true
					}
				}
			}

			// Send confirmation back to the current player
			err = conn.WriteJSON(Message{
				Type:           "placement_update",
				PlanesPlaced:   msg.PlanesPlaced,
				PlacementPhase: true,
			})
			if err != nil {
				log.Printf("Write error: %v", err)
			}

			// Notify opponent
			otherPlayerID := getOtherPlayerID(currentPlayerID)
			if otherPlayer, ok := currentRoom.Players[otherPlayerID]; ok {
				otherPlayer.WriteJSON(Message{
					Type:           "opponent_placement_update",
					OpponentReady:  msg.PlanesPlaced >= 3,
					PlacementPhase: true,
				})
			}
			currentRoom.mu.Unlock()

		case "remove_plane":
			if currentRoom == nil {
				continue
			}

			currentRoom.mu.Lock()
			// Update planes count directly from client message
			currentRoom.PlanesPlaced[currentPlayerID] = msg.PlanesPlaced

			// Reset ready state
			currentRoom.ReadyPlayers[currentPlayerID] = false

			// Notify both players of the update
			for pid, player := range currentRoom.Players {
				player.WriteJSON(Message{
					Type:           "placement_update",
					PlayerID:       pid,
					PlanesPlaced:   currentRoom.PlanesPlaced[pid],
					PlacementPhase: true,
				})
			}
			currentRoom.mu.Unlock()

		case "player_ready":
			if currentRoom == nil {
				continue
			}

			currentRoom.mu.Lock()
			currentRoom.ReadyPlayers[currentPlayerID] = true
			player1Ready := currentRoom.ReadyPlayers["1"]
			player2Ready := currentRoom.ReadyPlayers["2"]

			if player1Ready && player2Ready {
				// Start game - both players are ready
				for pid, player := range currentRoom.Players {
					player.WriteJSON(Message{
						Type:           "game_start",
						PlayerID:       pid,
						PlacementPhase: false,
						MyTurn:         pid == "1", // Player 1 starts
					})
				}
			}
			currentRoom.mu.Unlock()

		case "attack":
			if currentRoom == nil {
				continue
			}

			currentRoom.mu.Lock()
			otherPlayerID := getOtherPlayerID(currentPlayerID)
			opponentGrid := currentRoom.PlayerGrids[otherPlayerID]

			isHit := false
			isHeadHit := false
			if msg.Position >= 0 && msg.Position < len(opponentGrid) {
				isHit = opponentGrid[msg.Position]

				// Check if it's a head hit
				for _, headPos := range currentRoom.PlaneHeads[otherPlayerID] {
					if msg.Position == headPos {
						isHeadHit = true
						currentRoom.HeadHits[currentPlayerID]++
						break
					}
				}
			}

			// Check for game over
			gameOver := currentRoom.HeadHits[currentPlayerID] >= 3

			// Send result to attacker
			conn.WriteJSON(Message{
				Type:      "attack_result",
				Position:  msg.Position,
				IsHit:     isHit,
				IsHeadHit: isHeadHit,
				HeadHits:  currentRoom.HeadHits[currentPlayerID],
				GameOver:  gameOver,
				Winner:    currentPlayerID,
				MyTurn:    !gameOver,
			})

			// Notify opponent
			if opponent, ok := currentRoom.Players[otherPlayerID]; ok {
				opponent.WriteJSON(Message{
					Type:      "opponent_attack",
					Position:  msg.Position,
					IsHit:     isHit,
					IsHeadHit: isHeadHit,
					HeadHits:  currentRoom.HeadHits[currentPlayerID],
					GameOver:  gameOver,
					Winner:    currentPlayerID,
					MyTurn:    !gameOver,
				})
			}
			currentRoom.mu.Unlock()
		}
	}

	// Cleanup on disconnect
	if currentRoom != nil && currentPlayerID != "" {
		currentRoom.mu.Lock()
		delete(currentRoom.Players, currentPlayerID)
		delete(currentRoom.PlanesPlaced, currentPlayerID)
		delete(currentRoom.PlayerGrids, currentPlayerID)
		delete(currentRoom.ReadyPlayers, currentPlayerID)

		// Notify other player about disconnection
		otherPlayerID := getOtherPlayerID(currentPlayerID)
		if otherPlayer, ok := currentRoom.Players[otherPlayerID]; ok {
			otherPlayer.WriteJSON(Message{
				Type: "opponent_disconnected",
			})
		}
		currentRoom.mu.Unlock()
	}
}

func main() {
	server := NewGameServer()
	http.Handle("/", http.FileServer(http.Dir("static")))
	http.HandleFunc("/ws", server.handleWS)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080" // fallback port for local development
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe("0.0.0.0:"+port, nil))
}

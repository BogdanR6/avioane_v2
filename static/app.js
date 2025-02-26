const HitMarker = ({ type, isNew }) => {
    const [animate, setAnimate] = React.useState(isNew);
    
    React.useEffect(() => {
      if (animate) {
        const timer = setTimeout(() => setAnimate(false), 1000);
        return () => clearTimeout(timer);
      }
    }, []);
  
    switch (type) {
      case 'miss':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white rounded-full opacity-50"></div>
            {animate && (
              <div className="absolute w-3 h-3 border-2 border-white rounded-full animate-ping"></div>
            )}
          </div>
        );
      
      case 'hit':
      case 'plannedHit':  // For the grey version when marking suspected plane positions
        const isPlanned = type === 'plannedHit';
        const baseColor = isPlanned ? 'gray' : 'orange';
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Core of explosion */}
            <div className={`w-4 h-4 bg-${baseColor}-500 rounded-full ${animate ? 'animate-pulse' : ''}`}></div>
            
            {/* Expanding ring */}
            {animate && (
              <div className={`absolute w-5 h-5 border-2 border-${baseColor}-400 rounded-full animate-ping opacity-75`}></div>
            )}
            
            {/* Explosion rays */}
            <div className={`absolute ${animate ? 'animate-pulse' : ''}`}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                <div
                  key={angle}
                  className={`absolute w-3 h-0.5 bg-${baseColor}-400 origin-left`}
                  style={{ 
                    transform: `rotate(${angle}deg) translateX(4px)`,
                  }}
                />
              ))}
            </div>
          </div>
        );
      
      case 'headHit':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Simple diamond */}
            <div className="w-4 h-4 bg-red-600 rotate-45"></div>
            {animate && (
              <div className="absolute w-6 h-6 border-2 border-red-400 rotate-45 animate-ping"></div>
            )}
          </div>
        );
      
      case 'nextTarget':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Crosshair */}
            <div className="w-4 h-4 rounded-full border border-gray-400"></div>
            <div className="absolute h-4 w-px bg-gray-400"></div>
            <div className="absolute w-4 h-px bg-gray-400"></div>
          </div>
        );
        
      default:
        return null;
    }
};

const GameUI = () => {
    const [gameState, setGameState] = React.useState({
        status: 'disconnected',
        roomId: null,
        playerId: null,
        joinRoomId: '',
        myGrid: Array(100).fill(null),
        opponentGrid: Array(100).fill(null),
        myTurn: false,
        placementPhase: true,
        planesPlaced: 0,
        currentPlaneRotation: 0,
        shots: new Set(),
        hits: new Set(),
        headHits: new Set(),
        opponentShots: new Set(),
        opponentHits: new Set(),
        opponentHeadHits: new Set(),
        previewPositions: [],
        ready: false,
        gameOver: false,
        winner: null,
        myHeadHitsCount: 0,
        opponentHeadHitsCount: 0,
        markedCells: new Map(),
        lastAttackedCell: null,
        showJoinInput: false,
    });

    // WebSocket connection
    React.useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsUrl = protocol + window.location.host + '/ws';
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('Connected to server');
            setGameState(prev => ({ ...prev, status: 'connecting', ws }));
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            console.log('Received:', message);
            
            switch (message.type) {
                case 'room_created':
                    setGameState(prev => ({
                        ...prev,
                        status: 'waiting',
                        roomId: message.roomId,
                        playerId: message.playerId,
                        placementPhase: true,
                        planesPlaced: 0
                    }));
                    break;
                    
                case 'game_start':
                    setGameState(prev => ({
                        ...prev,
                        status: 'playing',
                        playerId: message.playerId,
                        placementPhase: message.placementPhase,
                        myTurn: message.myTurn
                    }));
                    break;

                case 'placement_update':
                    setGameState(prev => ({
                        ...prev,
                        planesPlaced: message.planesPlaced,
                        placementPhase: message.placementPhase
                    }));
                    break;

                case 'opponent_placement_update':
                    setGameState(prev => ({
                        ...prev,
                        placementPhase: message.placementPhase
                    }));
                    break;

                case 'attack_result':
                    setGameState(prev => ({
                        ...prev,
                        myTurn: !message.gameOver && false,
                        shots: new Set([...prev.shots, message.position]),
                        hits: new Set(
                            message.isHit 
                                ? [...prev.hits, message.position]
                                : [...prev.hits]
                        ),
                        headHits: new Set(
                            message.isHeadHit
                                ? [...prev.headHits, message.position]
                                : [...prev.headHits]
                        ),
                        myHeadHitsCount: message.headHits || prev.myHeadHitsCount,
                        gameOver: message.gameOver,
                        winner: message.gameOver ? message.winner : null
                    }));
                    break;
                    
                case 'opponent_attack':
                    setGameState(prev => ({
                        ...prev,
                        myTurn: !message.gameOver && true,
                        opponentShots: new Set([
                            ...(prev.opponentShots || []),
                            message.position
                        ]),
                        opponentHits: new Set(
                            message.isHit 
                                ? [...(prev.opponentHits || []), message.position]
                                : [...(prev.opponentHits || [])]
                        ),
                        opponentHeadHits: new Set(
                            message.isHeadHit
                                ? [...(prev.opponentHeadHits || []), message.position]
                                : [...(prev.opponentHeadHits || [])]
                        ),
                        opponentHeadHitsCount: message.headHits || prev.opponentHeadHitsCount,
                        gameOver: message.gameOver,
                        winner: message.gameOver ? message.winner : null
                    }));
                    break;
                
                case 'error':
                    alert(message.data);
                    break;

                case 'opponent_disconnected':
                    alert('Opponent disconnected!');
                    setGameState(prev => ({
                        ...prev,
                        status: 'connecting',
                        planesPlaced: 0,
                        myGrid: Array(100).fill(null),
                        opponentGrid: Array(100).fill(null),
                        ready: false
                    }));
                    break;
            }
        };

        ws.onclose = () => {
            console.log('Disconnected from server');
            setGameState(prev => ({ 
                ...prev, 
                status: 'disconnected',
                ws: null
            }));
        };

        return () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
    }, []);

    // Keyboard handler for plane rotation
    React.useEffect(() => {
        const handleKeyPress = (e) => {
            if (gameState.placementPhase) {
                if (e.key === 'r' || e.key === 'R') {
                    setGameState(prev => ({
                        ...prev,
                        currentPlaneRotation: (prev.currentPlaneRotation + 90) % 360
                    }));
                }
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [gameState.placementPhase]);

    const getPlanePositions = (index, rotation) => {
        const row = Math.floor(index / 10);
        const col = index % 10;
        const positions = [];

        switch(rotation) {
            case 0: // Up
                if (row + 3 >= 10 || col - 2 < 0 || col + 2 >= 10) return [];
                positions.push(
                    index,                    // head
                    index + 10,               // body
                    index + 10 - 2,           // left wing 1
                    index + 10 - 1,           // left wing 2
                    index + 10 + 1,           // right wing 1
                    index + 10 + 2,           // right wing 2
                    index + 20,               // tail 1
                    index + 30,               // tail 2
                    index + 30 - 1,           // left stabilizer
                    index + 30 + 1            // right stabilizer
                );
                break;

            case 90: // Right
                if (col - 3 < 0 || row - 2 < 0 || row + 2 >= 10) return [];
                positions.push(
                    index,
                    index - 1,
                    index - 1 - 20,
                    index - 1 - 10,
                    index - 1 + 10,
                    index - 1 + 20,
                    index - 2,
                    index - 3,
                    index - 3 - 10,
                    index - 3 + 10
                );
                break;

            case 180: // Down
                if (row - 3 < 0 || col - 2 < 0 || col + 2 >= 10) return [];
                positions.push(
                    index,
                    index - 10,
                    index - 10 - 2,
                    index - 10 - 1,
                    index - 10 + 1,
                    index - 10 + 2,
                    index - 20,
                    index - 30,
                    index - 30 - 1,
                    index - 30 + 1
                );
                break;

            case 270: // Left
                if (col + 3 >= 10 || row - 2 < 0 || row + 2 >= 10) return [];
                positions.push(
                    index,
                    index + 1,
                    index + 1 - 20,
                    index + 1 - 10,
                    index + 1 + 10,
                    index + 1 + 20,
                    index + 2,
                    index + 3,
                    index + 3 - 10,
                    index + 3 + 10
                );
                break;
        }

        return positions;
    };

    const handleGridHover = (index) => {
        if (!gameState.placementPhase || gameState.planesPlaced >= 3) return;
        
        const positions = getPlanePositions(index, gameState.currentPlaneRotation);
        setGameState(prev => ({
            ...prev,
            previewPositions: positions
        }));
    };

    const getPlaneColor = (planeNumber) => {
        switch(planeNumber) {
            case 1: return "bg-blue-400";  // Light blue
            case 2: return "bg-blue-600";  // Medium blue
            case 3: return "bg-blue-800";  // Dark blue
            default: return "bg-blue-600"; // Fallback
        }
    };
    
    const handlePlacePlane = (index) => {
        if (!gameState.placementPhase || gameState.planesPlaced >= 3) {
            console.log('Cannot place plane: phase check failed', {
                placementPhase: gameState.placementPhase,
                planesPlaced: gameState.planesPlaced
            });
            return;
        }
    
        const positions = getPlanePositions(index, gameState.currentPlaneRotation);
        console.log('Attempting to place plane at index', index, 'with positions:', positions);
        
        if (positions.length === 0 || positions.some(pos => gameState.myGrid[pos])) {
            console.log('Invalid plane position or overlap detected');
            return;
        }
    
        const newGrid = [...gameState.myGrid];
        const newPlaneNumber = gameState.planesPlaced + 1;
        positions.forEach(pos => {
            newGrid[pos] = newPlaneNumber; // Store plane number instead of just 'plane'
        });
    
        // Update local state
        setGameState(prev => ({
            ...prev,
            myGrid: newGrid,
            planesPlaced: newPlaneNumber,
            ready: false
        }));
    
        // Send to server
        if (gameState.ws?.readyState === WebSocket.OPEN) {
            const message = {
                type: 'place_plane',
                positions: positions,
                planesPlaced: newPlaneNumber,
                roomId: gameState.roomId
            };
            console.log('Sending to server:', message);
            gameState.ws.send(JSON.stringify(message));
        }
    };
    
    const handleRemovePlane = (index) => {
        if (!gameState.placementPhase || !gameState.myGrid[index]) {
            return;
        }

        console.log('Removing plane at index:', index);

        // Find all connected plane cells
        const connectedPositions = new Set();
        const visited = new Set();
        const stack = [index];

        while (stack.length > 0) {
            const pos = stack.pop();
            if (visited.has(pos)) continue;
            visited.add(pos);

            if (gameState.myGrid[pos] === 'plane') {
                connectedPositions.add(pos);
                
                // Check all 8 directions
                const row = Math.floor(pos / 10);
                const col = pos % 10;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        const newRow = row + dr;
                        const newCol = col + dc;
                        if (newRow >= 0 && newRow < 10 && newCol >= 0 && newCol < 10) {
                            const newPos = newRow * 10 + newCol;
                            if (!visited.has(newPos)) {
                                stack.push(newPos);
                            }
                        }
                    }
                }
            }
        }

        console.log('Found connected positions:', Array.from(connectedPositions));

        const newGrid = [...gameState.myGrid];
        connectedPositions.forEach(pos => {
            newGrid[pos] = null;
        });

        const newPlanesPlaced = Math.max(0, gameState.planesPlaced - 1);

        // Update local state
        setGameState(prev => ({
            ...prev,
            myGrid: newGrid,
            planesPlaced: newPlanesPlaced,
            ready: false
        }));

        // Send to server
        if (gameState.ws?.readyState === WebSocket.OPEN) {
            const message = {
                type: 'remove_plane',
                planesPlaced: newPlanesPlaced,
                roomId: gameState.roomId
            };
            console.log('Sending to server:', message);
            gameState.ws.send(JSON.stringify(message));
        }
    };

    const handleAttack = (index) => {
        if (!gameState.myTurn || gameState.placementPhase || gameState.shots.has(index)) {
            return;
        }

        setGameState(prev => ({
            ...prev,
            shots: new Set([...prev.shots, index]),
            myTurn: false,
            lastAttackedCell: index
        }));

        if (gameState.ws?.readyState === WebSocket.OPEN) {
            gameState.ws.send(JSON.stringify({
                type: 'attack',
                position: index,
                roomId: gameState.roomId
            }));
        }
    };

    const handleMarkCell = (index) => {
        if (gameState.placementPhase || gameState.shots.has(index)) {
            return;
        }

        setGameState(prev => {
            const newMarkedCells = new Map(prev.markedCells);
            const currentMark = newMarkedCells.get(index);
            
            if (!currentMark) {
                newMarkedCells.set(index, 'nextTarget'); // First right click
            } else if (currentMark === 'nextTarget') {
                newMarkedCells.set(index, 'plannedHit'); // Second right click
            } else {
                newMarkedCells.delete(index); // Third right click removes the mark
            }
            
            return {
                ...prev,
                markedCells: newMarkedCells
            };
        });
    };

    const getCellClassName = (index, isOpponent) => {
        let className = "aspect-square rounded-sm cursor-pointer transition-colors relative ";
        
        if (isOpponent) {
            className += gameState.myTurn && !gameState.gameOver && !gameState.shots.has(index)
                ? "bg-slate-700 hover:bg-slate-600"
                : "bg-slate-700";
        } else {
            if (gameState.placementPhase) {
                if (gameState.previewPositions.includes(index)) {
                    className += gameState.myGrid[index] 
                        ? "cell-preview-invalid"
                        : "cell-preview";
                } else if (gameState.myGrid[index]) {
                    className += getPlaneColor(gameState.myGrid[index]);
                } else {
                    className += "bg-slate-700";
                }
            } else {
                if (gameState.myGrid[index]) {
                    className += getPlaneColor(gameState.myGrid[index]);
                } else {
                    className += "bg-slate-700";
                }
            }
        }
    
        return className;
    };

    const renderPlacementControls = () => {
        return (
            <div className="mt-4 space-y-4">
                <div className="text-gray-300 text-sm">
                    <p>Controls:</p>
                    <ul className="list-disc list-inside">
                        <li>Left Click - Place plane</li>
                        <li>Right Click - Remove plane</li>
                        <li>Press 'R' - Rotate plane</li>
                    </ul>
                </div>
                {gameState.planesPlaced === 3 && !gameState.ready && (
                    <button
                        onClick={() => {
                            setGameState(prev => ({ ...prev, ready: true }));
                            gameState.ws?.send(JSON.stringify({
                                type: 'player_ready'
                            }));
                        }}
                        className="px-6 py-2 bg-green-500 hover:bg-green-600 rounded-lg transition-colors"
                    >
                        Ready!
                    </button>
                )}
                {gameState.ready && (
                    <div className="text-green-400">
                        Waiting for opponent...
                    </div>
                )}
            </div>
        );
    };

    const renderGrid = (isOpponent) => (
        <div className="grid grid-cols-10 gap-1">
            {Array(100).fill(null).map((_, index) => (
                <div 
                    key={index}
                    className={getCellClassName(index, isOpponent)}
                    onClick={() => isOpponent ? handleAttack(index) : handlePlacePlane(index)}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        if (isOpponent) {
                            handleMarkCell(index);
                        } else {
                            handleRemovePlane(index);
                        }
                    }}
                    onMouseEnter={() => !isOpponent && handleGridHover(index)}
                    onMouseLeave={() => !isOpponent && setGameState(prev => ({...prev, previewPositions: []}))}
                >
                    {/* Hit markers */}
                    {(isOpponent ? gameState.shots.has(index) : gameState.opponentShots?.has(index)) && (
                        <HitMarker 
                            type={
                                isOpponent
                                    ? gameState.headHits.has(index)
                                        ? 'headHit'
                                        : gameState.hits.has(index)
                                            ? 'hit'
                                            : 'miss'
                                    : gameState.opponentHeadHits?.has(index)
                                        ? 'headHit'
                                        : gameState.opponentHits?.has(index)
                                            ? 'hit'
                                            : 'miss'
                            }
                            isNew={index === gameState.lastAttackedCell}
                        />
                    )}
                    {/* Mark indicators */}
                    {isOpponent && gameState.markedCells.has(index) && !gameState.shots.has(index) && (
                        <HitMarker 
                            type={gameState.markedCells.get(index)}
                            isNew={false}
                        />
                    )}
                </div>
            ))}
        </div>
    );

    const renderGameControls = () => {
        if (gameState.placementPhase) {
            return renderPlacementControls();
        }
        return (
            <div className="text-gray-300 text-sm">
                <p>Controls:</p>
                <ul className="list-disc list-inside">
                    <li>Left Click - Attack a cell</li>
                    <li>Right Click - Mark/unmark a suspected plane cell</li>
                </ul>
            </div>
        );
    };

    // Render different states
    if (gameState.status === 'disconnected') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-8">
                <div className="max-w-md mx-auto text-center">
                    <p className="mb-4">Connecting to server...</p>
                </div>
            </div>
        );
    }

    // Inside your GameUI component, replace the 'connecting' state render with:

    if (gameState.status === 'connecting') {
        return (
            <div className="min-h-screen bg-slate-900 text-white">
                {/* Top Bar */}
                <div className="bg-slate-800/50 border-b border-slate-700">
                    <div className="container mx-auto px-4 py-3">
                        <div className="flex items-center gap-4">
                            <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-400 fill-current">
                                <path d="M12 2L2 8l10 6 10-6-10-6zM2 14l10 6 10-6M2 20l10 6 10-6"/>
                            </svg>
                            <div>
                                <h1 className="text-xl font-bold tracking-wider">AIRCRAFT COMBAT</h1>
                                <p className="text-sm text-gray-400">Strategic Battle Command</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="container mx-auto p-4">
                    <div className="grid md:grid-cols-3 gap-6">
                        {/* Left Panel - Navigation */}
                        <div className="space-y-4">
                            <div className="p-4 bg-slate-800/30 rounded-lg border border-slate-700">
                                <h2 className="text-sm font-bold mb-4 uppercase tracking-wider">Command Center</h2>
                                <nav className="space-y-2">
                                    {['Quick Battle', 'Loadout', 'Rankings', 'History'].map((item, index) => (
                                        <button
                                            key={item}
                                            disabled={index !== 0}
                                            className={`w-full p-2 rounded text-left text-sm ${
                                                index === 0 
                                                    ? 'bg-blue-500/20 text-blue-400' 
                                                    : 'text-gray-400 opacity-50'
                                            }`}
                                        >
                                            {item}
                                        </button>
                                    ))}
                                </nav>
                            </div>

                            <div className="p-4 bg-slate-800/30 rounded-lg border border-slate-700">
                                <h2 className="text-sm font-bold mb-4 uppercase tracking-wider">Battle Stats</h2>
                                <div className="space-y-2 text-sm text-gray-400">
                                    <p>Victories: --</p>
                                    <p>Success Rate: --%</p>
                                    <p>Current Streak: --</p>
                                </div>
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div className="md:col-span-2">
                            <div className="p-6 bg-slate-800/30 rounded-lg border border-slate-700">
                                <div className="mb-6">
                                    <h2 className="text-xl font-bold mb-2">QUICK DEPLOYMENT</h2>
                                    <p className="text-gray-400">Choose your battle entry point</p>
                                </div>

                                <div className="grid md:grid-cols-2 gap-4 mb-6">
                                    <button
                                        onClick={() => gameState.ws?.send(JSON.stringify({ type: 'create_room' }))}
                                        className="p-4 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-600 hover:border-blue-500 transition-colors group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                                                </svg>
                                            </div>
                                            <div className="text-left">
                                                <h3 className="font-semibold">Create Battle Room</h3>
                                                <p className="text-sm text-gray-400">Start a new mission</p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setGameState(prev => ({ ...prev, showJoinInput: true }))}
                                        className="p-4 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-600 hover:border-blue-500 transition-colors"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                                                </svg>
                                            </div>
                                            <div className="text-left">
                                                <h3 className="font-semibold">Join Battle</h3>
                                                <p className="text-sm text-gray-400">Enter existing battle</p>
                                            </div>
                                        </div>
                                    </button>
                                </div>

                                {gameState.showJoinInput && (
                                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-600">
                                        <input
                                            type="text"
                                            placeholder="Enter Battle Room Code"
                                            className="w-full p-3 mb-3 bg-slate-900/50 rounded border border-slate-600 focus:border-blue-500 outline-none text-white placeholder-gray-400"
                                            value={gameState.joinRoomId}
                                            onChange={(e) => setGameState(prev => ({ ...prev, joinRoomId: e.target.value }))}
                                        />
                                        <button 
                                            onClick={() => {
                                                if (!gameState.joinRoomId) {
                                                    alert('Please enter a room code');
                                                    return;
                                                }
                                                gameState.ws?.send(JSON.stringify({ 
                                                    type: 'join_room',
                                                    roomId: gameState.joinRoomId
                                                }));
                                            }}
                                            className="w-full p-3 bg-blue-600 hover:bg-blue-700 rounded transition-colors font-semibold"
                                        >
                                            Join Battle
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (gameState.status === 'waiting') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-8">
                <div className="max-w-md mx-auto text-center space-y-4">
                    <h2 className="text-xl">Room ID: {gameState.roomId}</h2>
                    <p>Waiting for opponent to join...</p>
                    <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-white p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-4 text-center">
                    {gameState.gameOver ? (
                        <h2 className="text-2xl mb-2">
                            Game Over! {gameState.winner === gameState.playerId ? "You Won!" : "Opponent Won!"}
                        </h2>
                    ) : (
                        <h2 className="text-2xl mb-2">
                            {gameState.placementPhase 
                                ? `Place your planes (${gameState.planesPlaced}/3)` 
                                : gameState.myTurn 
                                    ? "Your turn to attack!" 
                                    : "Opponent's turn..."
                            }
                        </h2>
                    )}
                    {!gameState.placementPhase && (
                        <div className="text-lg mb-4">
                            <p>Your Head Hits: {gameState.myHeadHitsCount}/3</p>
                            <p>Opponent Head Hits: {gameState.opponentHeadHitsCount}/3</p>
                        </div>
                    )}
                    {gameState.placementPhase && renderPlacementControls()}
                    {!gameState.placementPhase && renderGameControls()}
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-slate-800 p-4 rounded-lg">
                        <h3 className="text-xl mb-4">Your Grid</h3>
                        {renderGrid(false)}
                    </div>

                    <div className="bg-slate-800 p-4 rounded-lg">
                        <h3 className="text-xl mb-4">Opponent's Grid</h3>
                        {renderGrid(true)}
                    </div>
                </div>
            </div>
        </div>
    );
};

ReactDOM.render(<GameUI />, document.getElementById('root'));
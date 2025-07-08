import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trophy, Coins, Users, HelpCircle, CheckCircle, XCircle, Wifi, WifiOff, AlertCircle, Sparkles, Heart, Shield, Zap, Star, TrendingUp, TrendingDown } from 'lucide-react';
import io from 'socket.io-client';

// The URL for your socket.io server
const SOCKET_URL = 'https://highstapler.onrender.com';

const QuizGame = () => {
  // Socket reference
  const socketRef = useRef(null);
  
  // Connection status state
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  
  // Session management state
  const [sessionId, setSessionId] = useState(localStorage.getItem('sessionId') || '');
  const [reconnectToken, setReconnectToken] = useState(localStorage.getItem('reconnectToken') || '');
  
  // Game state
  const [gameState, setGameState] = useState('menu');
  const [gameId, setGameId] = useState('');
  const [playerRole, setPlayerRole] = useState(''); // 'host' or 'player2'
  const [gameRole, setGameRole] = useState(''); // 'challenger' or 'moderator'
  const [gameData, setGameData] = useState({});
  
  // Player name and game ID for joining
  const [playerName, setPlayerName] = useState('');
  const [joinGameId, setJoinGameId] = useState('');
  
  // Local UI states
  const [myAnswer, setMyAnswer] = useState('');
  const [myAnswered, setMyAnswered] = useState(false);
  const [animateScore, setAnimateScore] = useState(false);
  const [animateCoins, setAnimateCoins] = useState(false);
  const [showDecisionAnimation, setShowDecisionAnimation] = useState(false);
  const [lastPing, setLastPing] = useState(Date.now());

  // Heartbeat system to check connection health
  useEffect(() => {
    const interval = setInterval(() => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('pong');
        setLastPing(Date.now());
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Determines connection quality based on ping
  const getConnectionQuality = () => {
    const timeSinceLastPing = Date.now() - lastPing;
    if (timeSinceLastPing < 35000) return 'good';
    if (timeSinceLastPing < 60000) return 'poor';
    return 'bad';
  };

  // Initialize socket connection and set up event listeners
  const initializeSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socketOptions = {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true,
      auth: {}
    };

    if (reconnectToken) {
      socketOptions.auth.reconnectToken = reconnectToken;
    }

    socketRef.current = io(SOCKET_URL, socketOptions);

    // --- Socket Event Listeners ---
    socketRef.current.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
      setConnectionError('');
      setReconnecting(false);
      setLastPing(Date.now());
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      setConnected(false);
      if (reason === 'io server disconnect') {
        setConnectionError('Server hat Verbindung getrennt');
      } else {
        setReconnecting(true);
        if (reconnectToken) {
          setTimeout(attemptReconnect, 2000);
        }
      }
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionError('Verbindung zum Server fehlgeschlagen');
      setConnected(false);
      setReconnecting(false);
    });
    
    socketRef.current.on('ping', () => {
      socketRef.current.emit('pong');
      setLastPing(Date.now());
    });

    socketRef.current.on('game-created', (data) => {
      console.log('Game created:', data);
      setGameId(data.gameId);
      setGameData(data.game);
      setGameState('lobby');
      setPlayerRole('host');
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
        localStorage.setItem('sessionId', data.sessionId);
      }
      if (data.reconnectToken) {
        setReconnectToken(data.reconnectToken);
        localStorage.setItem('reconnectToken', data.reconnectToken);
      }
      
      localStorage.setItem('gameId', data.gameId);
      localStorage.setItem('playerName', playerName);
    });

    socketRef.current.on('joined-game', (data) => {
      console.log('Joined game:', data);
      setGameId(data.gameId);
      setPlayerRole(data.role);
      if (data.gameRole) setGameRole(data.gameRole);
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
        localStorage.setItem('sessionId', data.sessionId);
      }
      if (data.reconnectToken) {
        setReconnectToken(data.reconnectToken);
        localStorage.setItem('reconnectToken', data.reconnectToken);
      }
      
      localStorage.setItem('gameId', data.gameId);
      localStorage.setItem('playerName', playerName);
    });

    socketRef.current.on('game-updated', (game) => {
      console.log('Game updated:', game);

      if (gameData.challengerScore !== undefined && game.challengerScore > gameData.challengerScore) {
        setAnimateScore(true);
        setTimeout(() => setAnimateScore(false), 1000);
      }
      if (gameData.challengerCoins !== undefined && game.challengerCoins !== gameData.challengerCoins) {
        setAnimateCoins(true);
        setTimeout(() => setAnimateCoins(false), 1000);
      }

      setGameData(game);
      setGameState(game.state);

      const myPlayer = game.players?.find(p => p.id === socketRef.current.id);
      if (myPlayer?.gameRole) setGameRole(myPlayer.gameRole);

      if (game.phase === 'answering' && !game.challengerAnswered && !game.moderatorAnswered) {
        setMyAnswer('');
        setMyAnswered(false);
      }
      if (game.phase === 'result' && gameData.phase === 'decision') {
        setShowDecisionAnimation(true);
        setTimeout(() => setShowDecisionAnimation(false), 2000);
      }
      if (game.state === 'finished') {
        localStorage.removeItem('gameId');
        localStorage.removeItem('playerName');
        localStorage.removeItem('sessionId');
        localStorage.removeItem('reconnectToken');
      }
    });

    socketRef.current.on('game-started', (game) => {
      console.log('Game started:', game);
      setGameData(game);
      setGameState('playing');
    });

    socketRef.current.on('game-paused', (game) => {
      setGameData(game);
      setConnectionError('Ein Spieler hat das Spiel verlassen. Spiel pausiert.');
    });

    socketRef.current.on('game-resumed', (game) => {
      setGameData(game);
      setConnectionError('');
    });

    socketRef.current.on('player-disconnected', (data) => {
      setConnectionError(`${data.playerName} hat das Spiel verlassen.`);
    });

    socketRef.current.on('reconnect-success', (data) => {
      console.log('Reconnect successful:', data);
      setGameId(data.gameId);
      setPlayerRole(data.role);
      setGameRole(data.gameRole);
      setReconnecting(false);
      setConnectionError('');
    });

    socketRef.current.on('reconnect-failed', (data) => {
      console.log('Reconnect failed:', data);
      setReconnecting(false);
      setConnectionError('Wiederverbindung fehlgeschlagen');
      localStorage.removeItem('sessionId');
      localStorage.removeItem('reconnectToken');
      localStorage.removeItem('gameId');
      localStorage.removeItem('playerName');
      setReconnectToken('');
      setSessionId('');
    });

    socketRef.current.on('error', (data) => {
      console.error('Socket error:', data);
      setConnectionError(data.message || 'Ein Fehler ist aufgetreten');
    });

  }, [reconnectToken, playerName, gameData.phase, gameData.challengerScore, gameData.challengerCoins]);

  // Attempt reconnection with token
  const attemptReconnect = useCallback(() => {
    if (reconnectToken && socketRef.current) {
      console.log('Attempting reconnect with token:', reconnectToken);
      setReconnecting(true);
      socketRef.current.emit('reconnect-attempt', { reconnectToken });
    }
  }, [reconnectToken]);

  // Check for reconnect data on page load
  useEffect(() => {
    const savedGameId = localStorage.getItem('gameId');
    const savedPlayerName = localStorage.getItem('playerName');
    const savedReconnectToken = localStorage.getItem('reconnectToken');
    if (savedGameId && savedPlayerName && savedReconnectToken) {
      setPlayerName(savedPlayerName);
      setJoinGameId(savedGameId);
      setReconnectToken(savedReconnectToken);
    }
  }, []);

  // Initialize socket on mount
  useEffect(() => {
    initializeSocket();
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [initializeSocket]);

  // --- Game Actions ---
  const retryConnection = () => {
    setConnectionError('');
    setReconnecting(true);
    initializeSocket();
  };

  const createGame = () => {
    if (!playerName.trim() || !connected) return;
    socketRef.current.emit('create-game', { playerName: playerName.trim() });
  };

  const joinGame = () => {
    if (!joinGameId.trim() || !playerName.trim() || !connected) return;
    socketRef.current.emit('join-game', {
      gameId: joinGameId.toUpperCase(),
      playerName: playerName.trim()
    });
  };

  const startGame = () => {
    if (!connected) return;
    socketRef.current.emit('start-game', { gameId });
  };

  const submitAnswer = () => {
    if (!myAnswer || myAnswered || !connected) return;
    setMyAnswered(true);
    socketRef.current.emit('submit-answer', { gameId, answer: myAnswer });
  };

  const makeDecision = (decision) => {
    if (!connected) return;
    socketRef.current.emit('make-decision', { gameId, decision });
  };

  const nextRound = () => {
    if (!connected) return;
    socketRef.current.emit('next-round', { gameId });
  };

  // --- Render Helper Components ---
  const renderConnectionStatus = () => {
    const quality = getConnectionQuality();
    return (
      <div className={`fixed top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all z-50 ${
        connected 
          ? quality === 'good' ? 'bg-green-500/20 backdrop-blur' 
          : quality === 'poor' ? 'bg-yellow-500/20 backdrop-blur' 
          : 'bg-red-500/20 backdrop-blur'
          : 'bg-red-500/20 backdrop-blur'
      }`}>
        {connected ? (
          <>
            <Wifi className={`w-3 h-3 ${quality === 'good' ? 'text-green-400' : quality === 'poor' ? 'text-yellow-400' : 'text-red-400'}`} />
            <span className={`${quality === 'good' ? 'text-green-400' : quality === 'poor' ? 'text-yellow-400' : 'text-red-400'}`}>
              {reconnecting ? 'Reconnecting...' : 'Online'}
            </span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3 text-red-400" />
            <span className="text-red-400">{reconnecting ? 'Reconnecting...' : 'Offline'}</span>
          </>
        )}
      </div>
    );
  };

  const renderErrorNotification = () => {
    if (!connectionError) return null;
    return (
      <div className="fixed top-20 right-4 bg-red-500/20 backdrop-blur border border-red-500/50 rounded-xl p-4 max-w-sm animate-slide-in z-50">
        <div className="flex items-start gap-2">
          <AlertCircle className="text-red-400 w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-red-400 text-sm">{connectionError}</span>
            {!connected && (
              <button onClick={retryConnection} className="block mt-2 text-xs text-red-300 hover:text-red-100 underline">
                Erneut versuchen
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Input validation helpers
  const isValidPlayerName = (name) => name.trim().length >= 2 && name.trim().length <= 15;
  const isValidGameId = (id) => /^[A-Z0-9]{6}$/.test(id);

  // --- Main Render Logic based on gameState ---

  // Menu Screen
  if (gameState === 'menu') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <Shield className="w-16 h-16 text-blue-400 animate-float" />
                <Sparkles className="w-8 h-8 text-yellow-400 absolute -top-2 -right-2 animate-pulse" />
              </div>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Vertrauen oder Zweifeln</h1>
            <p className="text-gray-300 text-sm">Das ultimative Vertrauensspiel</p>
          </div>
          
          <div className="space-y-4">
            {/* Create Game */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Users className="text-blue-400" /> Neues Spiel
              </h2>
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-blue-400 focus:outline-none transition-all"
                    placeholder="Dein Name (2-15 Zeichen)"
                    maxLength={15}
                  />
                  {playerName && !isValidPlayerName(playerName) && (
                    <p className="text-red-400 text-xs mt-1">Name muss 2-15 Zeichen haben</p>
                  )}
                </div>
                <button
                  onClick={createGame}
                  disabled={!isValidPlayerName(playerName) || !connected}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-6 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Spiel erstellen' : 'Verbindung wird hergestellt...'}
                </button>
              </div>
            </div>
            
            {/* Join Game */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Wifi className="text-green-400" /> Spiel beitreten
              </h2>
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-green-400 focus:outline-none transition-all"
                    placeholder="Dein Name (2-15 Zeichen)"
                    maxLength={15}
                  />
                  {playerName && !isValidPlayerName(playerName) && (
                    <p className="text-red-400 text-xs mt-1">Name muss 2-15 Zeichen haben</p>
                  )}
                </div>
                <div>
                  <input
                    type="text"
                    value={joinGameId}
                    onChange={(e) => setJoinGameId(e.target.value.toUpperCase())}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-green-400 focus:outline-none transition-all font-mono text-center text-lg"
                    placeholder="SPIELCODE (6 Zeichen)"
                    maxLength={6}
                  />
                  {joinGameId && !isValidGameId(joinGameId) && (
                    <p className="text-red-400 text-xs mt-1">Spielcode muss 6 Zeichen haben</p>
                  )}
                </div>
                <button
                  onClick={joinGame}
                  disabled={!isValidPlayerName(playerName) || !isValidGameId(joinGameId) || !connected}
                  className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Beitreten' : 'Verbindung wird hergestellt...'}
                </button>
              </div>
            </div>
            
            {/* Reconnect Section */}
            {reconnectToken && (
              <div className="bg-yellow-500/10 backdrop-blur-lg rounded-2xl p-6 border border-yellow-500/30">
                <h2 className="text-lg font-bold text-yellow-400 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" /> Unterbrochenes Spiel
                </h2>
                <p className="text-gray-300 text-sm mb-4">
                  Du warst in einem Spiel. Möchtest du wieder beitreten?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={attemptReconnect}
                    disabled={!connected || reconnecting}
                    className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white font-bold py-2 px-4 rounded-xl hover:from-yellow-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {reconnecting ? 'Verbinde...' : 'Wieder beitreten'}
                  </button>
                  <button
                    onClick={() => {
                      localStorage.removeItem('reconnectToken');
                      localStorage.removeItem('sessionId');
                      localStorage.removeItem('gameId');
                      localStorage.removeItem('playerName');
                      setReconnectToken('');
                      setSessionId('');
                    }}
                    className="px-4 py-2 bg-white/20 text-white rounded-xl hover:bg-white/30 transition-all"
                  >
                    Verwerfen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Lobby Screen
  if (gameState === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Warte auf Spieler...</h1>
            <p className="text-gray-300 text-sm">Teile diesen Code:</p>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 mb-6 animate-scale-in">
            <div className="text-center">
              <div 
                className="text-5xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-4 animate-pulse cursor-pointer select-all"
                onClick={() => navigator.clipboard?.writeText(gameId)}
                title="Klicken zum Kopieren"
              >
                {gameId}
              </div>
              <p className="text-gray-300 text-sm">Spielcode (klicken zum kopieren)</p>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Spieler im Raum:</h3>
            <div className="space-y-2">
              {gameData.players?.map((player, index) => (
                <div key={index} className="flex items-center gap-3 bg-white/20 rounded-xl p-3 animate-slide-in" style={{animationDelay: `${index * 100}ms`}}>
                  <div className={`w-2 h-2 rounded-full animate-pulse ${player.connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  <span className="text-white font-medium flex-1">{player.name}</span>
                  {player.role === 'host' && (
                    <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-1 rounded-full">Host</span>
                  )}
                  {!player.connected && (
                    <span className="text-xs bg-red-500/30 text-red-300 px-2 py-1 rounded-full">Offline</span>
                  )}
                </div>
              ))}
              {gameData.players?.length === 1 && (
                <div className="flex items-center gap-3 bg-white/10 rounded-xl p-3 border-2 border-dashed border-white/30">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                  <span className="text-gray-400">Warte auf zweiten Spieler...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Setup Screen
  if (gameState === 'setup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Rollen werden verteilt...</h1>
            <p className="text-gray-300 text-sm">Das Schicksal entscheidet!</p>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 space-y-4 animate-scale-in">
            <div className={`bg-gradient-to-r from-blue-500/20 to-blue-600/20 rounded-xl p-4 text-center transform transition-all ${gameData.challengerName ? 'scale-100 opacity-100' : 'scale-95 opacity-50'}`}>
              <div className="flex justify-center mb-2"><Zap className="w-8 h-8 text-blue-400 animate-pulse" /></div>
              <h3 className="text-lg font-bold text-white mb-1">Herausforderer</h3>
              <p className="text-2xl font-bold text-blue-400">{gameData.challengerName || '...'}</p>
              <p className="text-gray-300 text-sm mt-2">Beantwortet Fragen & trifft Entscheidungen</p>
              <div className="mt-3 flex items-center justify-center gap-1">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-400 font-bold">{gameData.challengerCoins || gameData.initialCoins} Münzen zum Start</span>
              </div>
            </div>
            <div className={`bg-gradient-to-r from-purple-500/20 to-purple-600/20 rounded-xl p-4 text-center transform transition-all ${gameData.moderatorName ? 'scale-100 opacity-100' : 'scale-95 opacity-50'}`}>
              <div className="flex justify-center mb-2"><Shield className="w-8 h-8 text-purple-400 animate-pulse" /></div>
              <h3 className="text-lg font-bold text-white mb-1">Moderator</h3>
              <p className="text-2xl font-bold text-purple-400">{gameData.moderatorName || '...'}</p>
              <p className="text-gray-300 text-sm mt-2">Beantwortet Fragen & sammelt Vertrauen</p>
            </div>
            <div className="text-center pt-4">
              {playerRole === 'host' ? (
                <button
                  onClick={startGame}
                  disabled={!connected || !gameData.challengerName || !gameData.moderatorName}
                  className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-8 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Spiel starten' : 'Verbindung wird hergestellt...'}
                </button>
              ) : (
                <p className="text-gray-300 animate-pulse">Warte auf den Spielleiter...</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Playing Screen
  if (gameState === 'playing') {
    const currentQ = gameData.questions?.[gameData.currentQuestion];
    if (!currentQ) return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white text-xl">Lade Fragen...</p>
        </div>
      </div>
    );

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 pb-20">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-4 pt-4">
            <h1 className="text-2xl font-bold text-white">Vertrauen oder Zweifeln</h1>
            <p className="text-gray-300 text-sm">Frage {gameData.currentQuestion + 1}</p>
          </div>

          {/* Player Status Cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className={`bg-white/10 backdrop-blur-lg rounded-xl p-3 transform transition-all ${gameRole === 'challenger' ? 'ring-2 ring-blue-400 scale-105' : ''} ${animateScore && gameRole === 'challenger' ? 'animate-bounce' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="text-blue-400 w-4 h-4" />
                <span className="text-white font-bold text-sm">{gameData.challengerName}</span>
              </div>
              <div className="text-blue-400 text-xl font-bold">{gameData.challengerScore}</div>
              <div className={`flex items-center gap-1 mt-1 ${animateCoins ? 'animate-shake' : ''}`}>
                <Coins className="text-yellow-400 w-3 h-3" />
                <span className={`font-bold text-sm ${gameData.challengerCoins <= 1 ? 'text-red-400' : 'text-yellow-400'}`}>
                  {gameData.challengerCoins} {gameData.challengerCoins === 1 ? 'Münze' : 'Münzen'}
                </span>
              </div>
              {gameRole === 'challenger' && <div className="text-xs text-blue-300 mt-1">Das bist du!</div>}
            </div>
            
            <div className={`bg-white/10 backdrop-blur-lg rounded-xl p-3 transform transition-all ${gameRole === 'moderator' ? 'ring-2 ring-purple-400 scale-105' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="text-purple-400 w-4 h-4" />
                <span className="text-white font-bold text-sm">{gameData.moderatorName}</span>
              </div>
              <div className="text-purple-400 text-xl font-bold">{gameData.moderatorScore}</div>
              <div className="text-gray-400 text-xs mt-1">Moderator</div>
              {gameRole === 'moderator' && <div className="text-xs text-purple-300 mt-1">Das bist du!</div>}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="bg-white/10 rounded-full h-2 mb-6 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-500" style={{width: `${Math.max(gameData.challengerScore, gameData.moderatorScore) * 20}%`}}></div>
          </div>

          {/* Current Question */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6">
            <div className="text-center mb-4">
              <div className="text-xs text-gray-400 mb-1">Kategorie: {currentQ.category}</div>
              <h2 className="text-xl font-bold text-white">{currentQ.question}</h2>
            </div>
            
            {gameData.phase === 'answering' && (
              <div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {currentQ.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => setMyAnswer(index.toString())}
                      disabled={myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered) || !connected}
                      className={`p-3 rounded-xl border-2 transition-all transform hover:scale-105 active:scale-95 ${myAnswer === index.toString() ? 'border-blue-400 bg-blue-400/20 text-white' : 'border-white/30 bg-white/10 text-gray-300 hover:border-white/50 hover:bg-white/20'} ${(myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered) || !connected) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className="font-bold text-sm">{String.fromCharCode(65 + index)}) {option}</span>
                    </button>
                  ))}
                </div>
                <div className="text-center">
                  <button
                    onClick={submitAnswer}
                    disabled={!myAnswer || myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered) || !connected}
                    className="bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-8 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                  >
                    {!connected ? 'Verbindung unterbrochen' : (myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)) ? 'Antwort abgegeben' : 'Antwort abgeben'}
                  </button>
                  {(myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)) && (
                    <div className="mt-3">
                      <p className="text-gray-400 text-sm animate-pulse">Warte auf die Antwort des anderen Spielers...</p>
                      <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mx-auto mt-2"></div>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {gameData.phase === 'decision' && (
              <div className="text-center animate-fade-in">
                <div className="mb-4">
                  <div className="bg-white/20 rounded-xl p-4 mb-4">
                    <p className="text-sm text-gray-300 mb-2">Deine Antwort:</p>
                    {(() => {
                      const answerIndex = gameRole === 'challenger' ? parseInt(gameData.challengerAnswer) : parseInt(gameData.moderatorAnswer);
                      const isCorrect = gameRole === 'challenger' ? gameData.challengerCorrect : answerIndex === currentQ.correct;
                      return (
                        <>
                          <p className="text-lg font-bold">{String.fromCharCode(65 + answerIndex)} – {currentQ.options[answerIndex]}</p>
                          <div className="flex justify-center items-center gap-2 mt-2">
                            {isCorrect ? (
                              <><CheckCircle className="text-green-400 w-5 h-5" /><span className="text-green-400 font-bold">Richtig! +1 Punkt</span></>
                            ) : (
                              <><XCircle className="text-red-400 w-5 h-5" /><span className="text-red-400 font-bold">Falsch!</span></>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
                {gameRole === 'challenger' ? (
                  <div className="animate-scale-in">
                    <h3 className="text-lg font-bold text-white mb-3">Zeit für deine Entscheidung!</h3>
                    <p className="text-gray-300 mb-6 text-sm">{gameData.moderatorName} hat auch geantwortet.<br/>Vertraust du oder zweifelst du?</p>
                    <div className="flex gap-3 justify-center">
                      <button onClick={() => makeDecision('trust')} disabled={!connected} className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2">
                        <Heart className="w-4 h-4" /> Vertrauen
                      </button>
                      <button onClick={() => makeDecision('doubt')} disabled={gameData.challengerCoins <= 0 || !connected} className="bg-gradient-to-r from-red-500 to-pink-600 text-white font-bold py-3 px-6 rounded-xl hover:from-red-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2">
                        <Shield className="w-4 h-4" /> Zweifeln <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">-1 <Coins className="inline w-3 h-3" /></span>
                      </button>
                    </div>
                    {gameData.challengerCoins <= 0 && <p className="text-red-400 text-sm mt-3 animate-pulse">Keine Münzen mehr zum Zweifeln!</p>}
                  </div>
                ) : (
                  <div className="text-gray-400 animate-pulse">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Warte auf die Entscheidung von {gameData.challengerName}...</p>
                    <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mx-auto mt-2"></div>
                  </div>
                )}
              </div>
            )}
            
            {gameData.phase === 'result' && (
              <div className="text-center animate-fade-in">
                {showDecisionAnimation && (
                  <div className="mb-4 animate-bounce">
                    {gameData.decision === 'trust' ? <Heart className="w-16 h-16 text-green-400 mx-auto" /> : <Shield className="w-16 h-16 text-red-400 mx-auto" />}
                  </div>
                )}
                <h3 className="text-xl font-bold text-white mb-4">Rundenergebnis</h3>
                <div className="bg-white/20 rounded-xl p-4 mb-4 space-y-3">
                  <div>
                    <p className="text-sm text-gray-300">Herausforderer:</p>
                    <p className="font-bold">{String.fromCharCode(65 + parseInt(gameData.challengerAnswer))} - {currentQ.options[parseInt(gameData.challengerAnswer)]} {gameData.challengerCorrect ? <CheckCircle className="inline ml-2 text-green-400 w-4 h-4" /> : <XCircle className="inline ml-2 text-red-400 w-4 h-4" />}</p>
                  </div>
                  {gameData.showModeratorAnswer && (
                    <div className="animate-slide-in">
                      <p className="text-sm text-gray-300">Moderator:</p>
                      <p className="font-bold">{String.fromCharCode(65 + parseInt(gameData.moderatorAnswer))} - {currentQ.options[parseInt(gameData.moderatorAnswer)]} {parseInt(gameData.moderatorAnswer) === currentQ.correct ? <CheckCircle className="inline ml-2 text-green-400 w-4 h-4" /> : <XCircle className="inline ml-2 text-red-400 w-4 h-4" />}</p>
                    </div>
                  )}
                  <div className="pt-3 border-t border-white/30">
                    <p className="text-sm text-gray-300">Richtige Antwort:</p>
                    <p className="text-lg text-green-400 font-bold">{String.fromCharCode(65 + currentQ.correct)} - {currentQ.options[currentQ.correct]}</p>
                  </div>
                </div>
                <div className={`rounded-xl p-4 mb-6 ${gameData.roundResult?.includes('erhält 1 Punkt') ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                  <p className="text-white font-medium">{gameData.roundResult}</p>
                  {gameData.decision === 'doubt' && gameData.roundResult?.includes('verloren') && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-red-400"><TrendingDown className="w-4 h-4" /><span className="text-sm">Eine Münze verloren!</span></div>
                  )}
                  {gameData.decision === 'doubt' && gameData.roundResult?.includes('bleibt erhalten') && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-green-400"><TrendingUp className="w-4 h-4" /><span className="text-sm">Münze gerettet!</span></div>
                  )}
                </div>
                <button
                  onClick={nextRound}
                  disabled={!connected}
                  className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-8 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Nächste Runde' : 'Verbindung unterbrochen'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Finished Screen
  if (gameState === 'finished') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <Trophy className="text-yellow-400 w-20 h-20 mx-auto mb-4 animate-bounce" />
            <h1 className="text-3xl font-bold text-white mb-2">Spiel beendet!</h1>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-center animate-scale-in">
            <h2 className="text-2xl font-bold text-white mb-6">
              {gameData.winner === 'Unentschieden' ? (
                <span className="text-gray-400">Unentschieden!</span>
              ) : (
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400">{gameData.winner} gewinnt!</span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className={`bg-white/20 rounded-xl p-4 ${gameData.winner === gameData.challengerName ? 'ring-2 ring-yellow-400' : ''}`}>
                <Zap className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                <h3 className="font-bold text-white">{gameData.challengerName}</h3>
                <p className="text-2xl text-blue-400 font-bold">{gameData.challengerScore}</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Coins className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-gray-300">{gameData.challengerCoins} übrig</span>
                </div>
              </div>
              <div className={`bg-white/20 rounded-xl p-4 ${gameData.winner === gameData.moderatorName ? 'ring-2 ring-yellow-400' : ''}`}>
                <Shield className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                <h3 className="font-bold text-white">{gameData.moderatorName}</h3>
                <p className="text-2xl text-purple-400 font-bold">{gameData.moderatorScore}</p>
                <p className="text-sm text-gray-300 mt-1">Moderator</p>
              </div>
            </div>
            {gameData.challengerCoins <= 0 && gameData.winner === gameData.moderatorName && (
              <div className="bg-red-500/20 rounded-xl p-3 mb-4">
                <p className="text-red-400 text-sm flex items-center justify-center gap-2">
                  <Coins className="w-4 h-4" /> Herausforderer hat alle Münzen verloren!
                </p>
              </div>
            )}
            <div className="space-y-3">
              <button
                onClick={() => {
                  localStorage.clear();
                  setGameState('menu');
                  setGameData({});
                  setPlayerName('');
                  setJoinGameId('');
                  setGameRole('');
                  setPlayerRole('');
                  setMyAnswer('');
                  setMyAnswered(false);
                  if (socketRef.current) socketRef.current.disconnect();
                  setTimeout(initializeSocket, 500);
                }}
                className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95"
              >
                Neues Spiel
              </button>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: 'Vertrauen oder Zweifeln',
                      text: `Ich habe gerade ${gameData.winner === gameData.challengerName ? 'als Herausforderer' : 'als Moderator'} ${gameData.winner === (gameRole === 'challenger' ? gameData.challengerName : gameData.moderatorName) ? 'gewonnen' : 'verloren'}!`,
                      url: window.location.href
                    });
                  } else {
                    navigator.clipboard?.writeText(`Ich habe gerade Vertrauen oder Zweifeln gespielt! ${window.location.href}`);
                  }
                }}
                className="w-full bg-white/20 text-white font-bold py-2 px-6 rounded-xl hover:bg-white/30 transition-all"
              >
                Ergebnis teilen
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Paused/Error state
  if (gameState === 'paused' || connectionError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 flex items-center justify-center">
        {renderConnectionStatus()}
        <div className="max-w-md mx-auto text-center">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8">
            <AlertCircle className="w-16 h-16 text-yellow-400 mx-auto mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold text-white mb-4">Spiel pausiert</h2>
            <p className="text-gray-300 mb-6">{connectionError || 'Verbindungsprobleme erkannt'}</p>
            <div className="space-y-3">
              <button
                onClick={retryConnection}
                disabled={reconnecting}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-6 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {reconnecting ? 'Verbinde...' : 'Neu verbinden'}
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="w-full bg-white/20 text-white font-bold py-2 px-6 rounded-xl hover:bg-white/30 transition-all"
              >
                Zum Hauptmenü
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default Loading state
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 flex items-center justify-center">
      {renderConnectionStatus()}
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white text-xl">Verbindung wird hergestellt...</p>
      </div>
    </div>
  );
};

export default QuizGame;

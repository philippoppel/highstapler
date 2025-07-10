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
  const [wantToSkip, setWantToSkip] = useState(false);
  const [skipRequested, setSkipRequested] = useState(false);

  const [gameDifficulty, setGameDifficulty] = useState('medium');
  const [gameCategory, setGameCategory] = useState('');
  const [windowFocused, setWindowFocused] = useState(true);
  const [focusWarningShown, setFocusWarningShown] = useState(false);
  const [focusLostTime, setFocusLostTime] = useState(null);
  
  const [canReportAfterAnswer, setCanReportAfterAnswer] = useState(false);

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

  // Auto-dismiss error notifications after 5 seconds (except connection errors)
  useEffect(() => {
    if (connectionError && connected && !connectionError.includes('disconnected') && !connectionError.includes('left')) {
      const timer = setTimeout(() => {
        setConnectionError('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [connectionError, connected]);

  // Focus detection for anti-cheat
  useEffect(() => {
    const handleFocus = () => {
      setWindowFocused(true);
      if (focusLostTime) {
        const timeAway = Date.now() - focusLostTime;
        if (timeAway > 3000 && gameState === 'playing') { // 3 seconds threshold
          setFocusWarningShown(true);
          setTimeout(() => setFocusWarningShown(false), 5000);
        }
        setFocusLostTime(null);
      }
    };

    const handleBlur = () => {
      setWindowFocused(false);
      if (gameState === 'playing' && gameData.phase === 'answering') {
        setFocusLostTime(Date.now());
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleBlur();
      } else {
        handleFocus();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [gameState, gameData.phase, focusLostTime]);

  // Determines connection quality based on ping
  const getConnectionQuality = () => {
    const timeSinceLastPing = Date.now() - lastPing;
    if (timeSinceLastPing < 35000) return 'good';
    if (timeSinceLastPing < 60000) return 'poor';
    return 'bad';
  };

  const requestSkip = () => {
    if (!connected || skipRequested) return;
    setSkipRequested(true);
    socketRef.current.emit('request-skip', { gameId, reason: 'Question unclear or invalid' });
  };

  const cancelSkip = () => {
    if (!connected) return;
    setSkipRequested(false);
    socketRef.current.emit('cancel-skip', { gameId });
  };

  const clearAllSessionData = () => {
    localStorage.removeItem('sessionId');
    localStorage.removeItem('reconnectToken');
    localStorage.removeItem('gameId');
    localStorage.removeItem('playerName');
    localStorage.removeItem('tokenTimestamp');
    setSessionId('');
    setReconnectToken('');
    setGameId('');
    setPlayerRole('');
    setGameRole('');
    setGameState('menu');
    setGameData({});
    setMyAnswer('');
    setMyAnswered(false);
  };

  // Initialize socket connection and set up event listeners
  const initializeSocket = useCallback(() => {
    // Cleanup old socket completely
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  
    const socketOptions = {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true,
      auth: {}
    };

    if (reconnectToken && gameState !== 'menu' && gameState !== 'finished') {
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
        setConnectionError('Server has disconnected');
      } else {
        setReconnecting(true);
        if (reconnectToken) {
          setTimeout(attemptReconnect, 2000);
        }
      }
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionError('Failed to connect to server');
      setConnected(false);
      setReconnecting(false);
    });
    
    socketRef.current.on('ping', () => {
      socketRef.current.emit('pong');
      setLastPing(Date.now());
    });

    socketRef.current.on('game-created', (data) => {
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
        localStorage.setItem('tokenTimestamp', Date.now().toString());
      }
      
      localStorage.setItem('gameId', data.gameId);
      localStorage.setItem('playerName', playerName);
    });

    socketRef.current.on('joined-game', (data) => {
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
        localStorage.setItem('tokenTimestamp', Date.now().toString());
      }
      
      localStorage.setItem('gameId', data.gameId);
      localStorage.setItem('playerName', playerName);
    });

    socketRef.current.on('skip-requested', (data) => {
      console.log('Skip requested by:', data.playerName);
      setWantToSkip(true);
    });
    
    socketRef.current.on('skip-cancelled', () => {
      console.log('Skip cancelled');
      setWantToSkip(false);
      setSkipRequested(false);
    });
    
    socketRef.current.on('question-skipped', () => {
      console.log('Question skipped');
      setWantToSkip(false);
      setSkipRequested(false);
      setMyAnswer('');
      setMyAnswered(false);
    });

    socketRef.current.on('game-updated', (game) => {    
      if (gameData.challengerScore !== undefined && game.challengerScore > gameData.challengerScore) {
        setAnimateScore(true);
        setTimeout(() => setAnimateScore(false), 1000);
      }
      if (gameData.challengerCoins !== undefined && game.challengerCoins !== gameData.challengerCoins) {
        setAnimateCoins(true);
        setTimeout(() => setAnimateCoins(false), 1000);
      }
    
      setGameData(prevGameData => {
        // Animationen nur wenn sich Werte ändern
        if (prevGameData.challengerScore !== undefined && game.challengerScore > prevGameData.challengerScore) {
          setAnimateScore(true);
          setTimeout(() => setAnimateScore(false), 1000);
        }
        if (prevGameData.challengerCoins !== undefined && game.challengerCoins !== prevGameData.challengerCoins) {
          setAnimateCoins(true);
          setTimeout(() => setAnimateCoins(false), 1000);
        }
        
        return game;
      });
      
      setGameState(game.state);
    
      const myPlayer = game.players?.find(p => p.id === socketRef.current.id);
      if (myPlayer?.gameRole) setGameRole(myPlayer.gameRole);
      
      if (game.phase === 'answering' && !game.challengerAnswered && !game.moderatorAnswered) {
        setMyAnswer('');
        setMyAnswered(false);
        setCanReportAfterAnswer(false);
        setWantToSkip(false);
        setSkipRequested(false);
      }
      
      // Enable reporting after both players answered
      if (game.phase === 'decision' && game.challengerAnswered && game.moderatorAnswered) {
        setCanReportAfterAnswer(true);
      }
      
      if (game.phase === 'result' && prevGameData.phase === 'decision') {
        setShowDecisionAnimation(true);
        setTimeout(() => setShowDecisionAnimation(false), 2000);
      }
      if (game.phase === 'answering' && !game.challengerAnswered && !game.moderatorAnswered) {
        setMyAnswer('');
        setMyAnswered(false);
        setWantToSkip(false);
        setSkipRequested(false);
        setCanReportAfterAnswer(false);
        setPostAnswerReportRequested(false);
      }
    });
    
    
    socketRef.current.on('question-invalidated', (data) => {
      console.log('Question invalidated - both players agreed');
      setCanReportAfterAnswer(false);
      setPostAnswerReportRequested(false);
      setConnectionError(`Question was reported as invalid. Both players get 0 points.`);
      setTimeout(() => setConnectionError(''), 4000);
    });

    socketRef.current.on('game-started', (game) => {
      setGameData(game);
      setGameState('playing');
    });

    socketRef.current.on('game-paused', (game) => {
      setGameData(game);
      setConnectionError('A player has left the game. Game paused.');
    });

    socketRef.current.on('game-resumed', (game) => {
      setGameData(game);
      setConnectionError('');
    });

    socketRef.current.on('player-disconnected', (data) => {
      setConnectionError(`${data.playerName} has left the game.`);
    });

    socketRef.current.on('reconnect-success', (data) => {
      setGameId(data.gameId);
      setPlayerRole(data.role);
      setGameRole(data.gameRole);
      setReconnecting(false);
      setConnectionError('');
    });

    socketRef.current.on('reconnect-failed', (data) => {
      setReconnecting(false);
      setConnectionError('Reconnection failed');
      clearAllSessionData();
    });

    socketRef.current.on('error', (data) => {
      console.error('Socket error:', data);
      setConnectionError(data.message || 'An error occurred');
    });

  }, [reconnectToken]);

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
    const savedTimestamp = localStorage.getItem('tokenTimestamp');
    
    if (savedGameId && savedPlayerName && savedReconnectToken && gameState === 'menu') {
      const tokenAge = Date.now() - (parseInt(savedTimestamp) || 0);
      if (tokenAge < 30 * 60 * 1000) { // 30 Minuten
        setPlayerName(savedPlayerName);
        setJoinGameId(savedGameId);
        setReconnectToken(savedReconnectToken);
        setTimeout(() => {
          if (socketRef.current?.connected) {
            attemptReconnect();
          }
        }, 500);
      } else {
        clearAllSessionData();
      }
    }
  }, [attemptReconnect, gameState]);

  // Initialize socket on mount
  useEffect(() => {
    initializeSocket();
    return () => {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // --- Game Actions ---
  const retryConnection = () => {
    setConnectionError('');
    setReconnecting(true);
    initializeSocket();
  };

  const createGame = () => {
    if (!playerName.trim() || !connected) return;
    socketRef.current.emit('create-game', { 
      playerName: playerName.trim(),
      settings: {
        difficulty: gameDifficulty,
        category: gameCategory.trim() || null
      }
    });
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
    if (!myAnswer || myAnswered || !connected || !socketRef.current?.connected) {
      return;
    }
  
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

  const requestPostAnswerReport = () => {
    if (!connected || !canReportAfterAnswer) return;
    socketRef.current.emit('request-post-answer-report', { gameId, reason: 'Question invalid after seeing answers' });
  };
  
  const cancelPostAnswerReport = () => {
    if (!connected) return;
    socketRef.current.emit('cancel-post-answer-report', { gameId });
  };

  // --- Render Helper Components ---
  const renderConnectionStatus = () => {
    const quality = getConnectionQuality();
    return (
      <div className="fixed top-4 right-4 space-y-2 z-50">
        {/* Connection Status */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all ${
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
        
        {/* Focus Status - only show during answering phase */}
        {gameState === 'playing' && gameData.phase === 'answering' && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all ${
            windowFocused ? 'bg-green-500/20 backdrop-blur' : 'bg-red-500/20 backdrop-blur animate-pulse'
          }`}>
            {windowFocused ? (
              <>
                <CheckCircle className="w-3 h-3 text-green-400" />
                <span className="text-green-400">Focused</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-red-400" />
                <span className="text-red-400">Away</span>
              </>
            )}
          </div>
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
                Try again
              </button>
            )}
          </div>
          <button 
            onClick={() => setConnectionError('')}
            className="text-red-400 hover:text-red-200 text-lg leading-none"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  const renderFocusWarning = () => {
    if (!focusWarningShown) return null;
    return (
      <div className="fixed top-32 right-4 bg-orange-500/20 backdrop-blur border border-orange-500/50 rounded-xl p-4 max-w-sm animate-slide-in z-50">
        <div className="flex items-start gap-2">
          <AlertCircle className="text-orange-400 w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-orange-400 text-sm font-bold">Focus Warning!</span>
            <p className="text-orange-300 text-xs mt-1">You left the game window. Fair play is encouraged!</p>
          </div>
          <button 
            onClick={() => setFocusWarningShown(false)}
            className="text-orange-400 hover:text-orange-200 text-lg leading-none"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  // Input validation helpers
  const isValidPlayerName = (name) => name.trim().length >= 2 && name.trim().length <= 15;
  const isValidGameId = (id) => /^[A-Z0-9]{6}$/.test(id);

  // --- Main Render Logic based on gameState ---
  // Role Selection Screen
  if (gameState === 'role-selection') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        {renderFocusWarning()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Choose Roles</h1>
            <p className="text-gray-300 text-sm">Game Master, pick your role!</p>
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 animate-scale-in">
            {playerRole === 'host' ? (
              <div className="space-y-6">
                <div className="text-center mb-4">
                  <p className="text-white text-sm mb-4">Choose which role you want to play:</p>
                </div>
                
                <div className="grid grid-cols-1 gap-4">
                  <button 
                    onClick={() => socketRef.current.emit('choose-role', {gameId, choice: 'challenger'})}
                    disabled={!connected}
                    className="bg-gradient-to-r from-blue-500/20 to-blue-600/20 p-6 rounded-xl hover:from-blue-500/30 hover:to-blue-600/30 transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-4">
                      <Zap className="w-10 h-10 text-blue-400" />
                      <div className="text-left flex-1">
                        <h3 className="text-lg font-bold text-white">I'll be Challenger</h3>
                        <p className="text-gray-300 text-sm">Answer questions, make decisions, risk coins</p>
                        <div className="flex items-center gap-1 mt-2">
                          <Coins className="w-4 h-4 text-yellow-400" />
                          <span className="text-yellow-400 text-sm font-bold">Start with {gameData.initialCoins || '1-3'} coins</span>
                        </div>
                      </div>
                    </div>
                  </button>
                  
                  <button 
                    onClick={() => socketRef.current.emit('choose-role', {gameId, choice: 'moderator'})}
                    disabled={!connected}
                    className="bg-gradient-to-r from-purple-500/20 to-purple-600/20 p-6 rounded-xl hover:from-purple-500/30 hover:to-purple-600/30 transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-4">
                      <Shield className="w-10 h-10 text-purple-400" />
                      <div className="text-left flex-1">
                        <h3 className="text-lg font-bold text-white">I'll be Moderator</h3>
                        <p className="text-gray-300 text-sm">Answer questions, build trust, earn points</p>
                        <p className="text-purple-300 text-sm mt-2">Earn points when trusted or when right</p>
                      </div>
                    </div>
                  </button>
                </div>
                
                <div className="text-center pt-4 border-t border-white/20">
                  <button 
                    onClick={() => socketRef.current.emit('choose-role', {gameId, choice: 'random'})}
                    disabled={!connected}
                    className="bg-white/20 text-white py-3 px-6 rounded-xl hover:bg-white/30 transition-all"
                  >
                    🎲 Random Assignment
                  </button>
                  <p className="text-gray-400 text-xs mt-2">Let fate decide!</p>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="animate-pulse mb-4">
                  <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Waiting for Game Master</h3>
                <p className="text-gray-300 text-sm">The host is choosing roles...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Menu Screen
  if (gameState === 'menu') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        {renderFocusWarning()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <Shield className="w-16 h-16 text-blue-400 animate-float" />
                <Sparkles className="w-8 h-8 text-yellow-400 absolute -top-2 -right-2 animate-pulse" />
              </div>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Trust or Doubt</h1>
            <p className="text-gray-300 text-sm">The ultimate game of trust</p>
          </div>
          
          <div className="space-y-4">
            {/* AI Disclaimer */}
            <div className="bg-yellow-500/10 backdrop-blur-lg rounded-xl p-4 border border-yellow-500/30">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-yellow-400 font-bold text-sm mb-1">AI-Generated Content</h3>
                  <p className="text-yellow-300 text-xs leading-relaxed">
                    Questions and answers are AI-generated and may contain errors. 
                    Report invalid questions during gameplay if needed.
                  </p>
                </div>
              </div>
            </div>

            {/* Game Rules Summary */}
            <div className="bg-white/5 rounded-xl p-4 mb-6 text-xs text-gray-400">
              <h4 className="text-white font-bold mb-2">How to play:</h4>
              <ul className="space-y-1 text-left">
                <li>• Challenger: Answer questions, then trust or doubt the moderator</li>
                <li>• Moderator: Answer questions and build trust to earn points</li>
                <li>• Doubt costs 1 coin, but you get it back if moderator is wrong</li>
                <li>• First to 5 points wins, or moderator wins if challenger hits 0 coins</li>
                <li>• Questions are AI-generated and may contain errors</li>
              </ul>
            </div>

            {/* Create Game */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Users className="text-blue-400" /> New Game
              </h2>
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-blue-400 focus:outline-none transition-all"
                    placeholder="Your name (2-15 characters)"
                    maxLength={15}
                  />
                  {playerName && !isValidPlayerName(playerName) && (
                    <p className="text-red-400 text-xs mt-1">Name must be 2-15 characters</p>
                  )}
                </div>
                
                {/* Difficulty Selection */}
                <div>
                  <label className="text-white text-sm mb-2 block">Difficulty</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setGameDifficulty('easy')}
                      className={`p-2 rounded-lg transition-all ${gameDifficulty === 'easy' ? 'bg-green-500/30 border-green-400 border-2' : 'bg-white/10 border-white/30 border'}`}
                    >
                      <span className="text-white text-sm">Easy</span>
                    </button>
                    <button
                      onClick={() => setGameDifficulty('medium')}
                      className={`p-2 rounded-lg transition-all ${gameDifficulty === 'medium' ? 'bg-yellow-500/30 border-yellow-400 border-2' : 'bg-white/10 border-white/30 border'}`}
                    >
                      <span className="text-white text-sm">Medium</span>
                    </button>
                    <button
                      onClick={() => setGameDifficulty('hard')}
                      className={`p-2 rounded-lg transition-all ${gameDifficulty === 'hard' ? 'bg-red-500/30 border-red-400 border-2' : 'bg-white/10 border-white/30 border'}`}
                    >
                      <span className="text-white text-sm">Hard</span>
                    </button>
                  </div>
                </div>
                
                {/* Category Input */}
                <div>
                  <label className="text-white text-sm mb-2 block">
                    Topic/Category <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={gameCategory}
                    onChange={(e) => setGameCategory(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-blue-400 focus:outline-none transition-all"
                    placeholder="e.g. SpongeBob, Marvel, History..."
                    maxLength={30}
                  />
                  <p className="text-gray-400 text-xs mt-1">Leave empty for general knowledge</p>
                </div>
                
                <button
                  onClick={createGame}
                  disabled={!isValidPlayerName(playerName) || !connected}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-6 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Create Game' : 'Connecting...'}
                </button>
              </div>
            </div>
            
            {/* Join Game */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Wifi className="text-green-400" /> Join Game
              </h2>
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-green-400 focus:outline-none transition-all"
                    placeholder="Your name (2-15 characters)"
                    maxLength={15}
                  />
                  {playerName && !isValidPlayerName(playerName) && (
                    <p className="text-red-400 text-xs mt-1">Name must be 2-15 characters</p>
                  )}
                </div>
                <div>
                  <input
                    type="text"
                    value={joinGameId}
                    onChange={(e) => setJoinGameId(e.target.value.toUpperCase())}
                    className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-green-400 focus:outline-none transition-all font-mono text-center text-lg"
                    placeholder="GAME CODE (6 characters)"
                    maxLength={6}
                  />
                  {joinGameId && !isValidGameId(joinGameId) && (
                    <p className="text-red-400 text-xs mt-1">Game code must be 6 characters</p>
                  )}
                </div>
                <button
                  onClick={joinGame}
                  disabled={!isValidPlayerName(playerName) || !isValidGameId(joinGameId) || !connected}
                  className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Join' : 'Connecting...'}
                </button>
              </div>
            </div>
            
            {/* Reconnect Section */}
            {reconnectToken && (
              <div className="bg-yellow-500/10 backdrop-blur-lg rounded-2xl p-6 border border-yellow-500/30">
                <h2 className="text-lg font-bold text-yellow-400 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" /> Game in Progress
                </h2>
                <p className="text-gray-300 text-sm mb-4">
                  You were in a game. Would you like to rejoin?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={attemptReconnect}
                    disabled={!connected || reconnecting}
                    className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white font-bold py-2 px-4 rounded-xl hover:from-yellow-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {reconnecting ? 'Connecting...' : 'Rejoin'}
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
                    Dismiss
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
        {renderFocusWarning()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Waiting for players...</h1>
            <p className="text-gray-300 text-sm">Share this code:</p>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 mb-6 animate-scale-in">
            <div className="text-center">
              <div 
                className="text-5xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-4 animate-pulse cursor-pointer select-all"
                onClick={() => navigator.clipboard?.writeText(gameId)}
                title="Click to copy"
              >
                {gameId}
              </div>
              <p className="text-gray-300 text-sm">Game code (click to copy)</p>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Players in room:</h3>
          <button 
            onClick={() => socketRef.current?.emit('request-game-update', { gameId })}
            className="text-xs text-gray-400 hover:text-white"
          >
            🔄 Refresh
          </button>
        </div>
            <div className="space-y-2">
              {gameData.players?.map((player, index) => (
                <div key={index} className="flex items-center gap-3 bg-white/20 rounded-xl p-3 animate-slide-in" style={{animationDelay: `${index * 100}ms`}}>
                  <div className={`w-2 h-2 rounded-full animate-pulse ${player.connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  <span className="text-white font-medium flex-1">{player.name}</span>
                  {player.role === 'host' && (
                    <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-1 rounded-full">Game Master</span>
                  )}
                  {!player.connected && (
                    <span className="text-xs bg-red-500/30 text-red-300 px-2 py-1 rounded-full">Disconnected</span>
                  )}
                </div>
              ))}
              {gameData.players?.length === 1 && (
                <div className="flex items-center gap-3 bg-white/10 rounded-xl p-3 border-2 border-dashed border-white/30">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                  <span className="text-gray-400">Waiting for second player...</span>
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
        {renderFocusWarning()}
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Assigning Roles...</h1>
            <p className="text-gray-300 text-sm">Let fate decide!</p>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 space-y-4 animate-scale-in">
            <div className={`bg-gradient-to-r from-blue-500/20 to-blue-600/20 rounded-xl p-4 text-center transform transition-all ${gameData.challengerName ? 'scale-100 opacity-100' : 'scale-95 opacity-50'}`}>
              <div className="flex justify-center mb-2"><Zap className="w-8 h-8 text-blue-400 animate-pulse" /></div>
              <h3 className="text-lg font-bold text-white mb-1">Challenger</h3>
              <p className="text-2xl font-bold text-blue-400">{gameData.challengerName || '...'}</p>
              <p className="text-gray-300 text-sm mt-2">Answers questions & makes decisions</p>
              <div className="mt-3 flex items-center justify-center gap-1">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-400 font-bold">{gameData.challengerCoins || gameData.initialCoins} starting coins</span>
              </div>
            </div>
            <div className={`bg-gradient-to-r from-purple-500/20 to-purple-600/20 rounded-xl p-4 text-center transform transition-all ${gameData.moderatorName ? 'scale-100 opacity-100' : 'scale-95 opacity-50'}`}>
              <div className="flex justify-center mb-2"><Shield className="w-8 h-8 text-purple-400 animate-pulse" /></div>
              <h3 className="text-lg font-bold text-white mb-1">Moderator</h3>
              <p className="text-2xl font-bold text-purple-400">{gameData.moderatorName || '...'}</p>
              <p className="text-gray-300 text-sm mt-2">Answers questions & builds trust</p>
            </div>
            <div className="text-center pt-4">
            {playerRole === 'host' && gameData.players?.length === 2 && (
          <button
            onClick={() => socketRef.current?.emit('start-game', { gameId })}
            disabled={!connected}
            className="w-full mt-4 bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Start Game
          </button>
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

    if (!currentQ) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white text-xl">Loading questions...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 pb-20">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        {renderFocusWarning()}
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-4 pt-4">
            <h1 className="text-2xl font-bold text-white">Trust or Doubt</h1>
            <p className="text-gray-300 text-sm">Question {gameData.currentQuestion + 1}</p>
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
                  {gameData.challengerCoins} {gameData.challengerCoins === 1 ? 'coin' : 'coins'}
                </span>
              </div>
              {gameRole === 'challenger' && <div className="text-xs text-blue-300 mt-1">That's you!</div>}
            </div>
            
            <div className={`bg-white/10 backdrop-blur-lg rounded-xl p-3 transform transition-all ${gameRole === 'moderator' ? 'ring-2 ring-purple-400 scale-105' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="text-purple-400 w-4 h-4" />
                <span className="text-white font-bold text-sm">{gameData.moderatorName}</span>
              </div>
              <div className="text-purple-400 text-xl font-bold">{gameData.moderatorScore}</div>
              <div className="text-gray-400 text-xs mt-1">Moderator</div>
              {gameRole === 'moderator' && <div className="text-xs text-purple-300 mt-1">That's you!</div>}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="bg-white/10 rounded-full h-2 mb-6 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-500" style={{width: `${Math.max(gameData.challengerScore, gameData.moderatorScore) * 20}%`}}></div>
          </div>

          {/* Current Question */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6">
            <div className="text-center mb-4">
              <div className="text-xs text-gray-400 mb-1">Category: {currentQ.category}</div>
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
                    {!connected ? 'Connection lost' : (myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)) ? 'Answered' : 'Answer'}
                  </button>
                  
                  {/* Skip/Report Section */}
                  <div className="mt-4 text-center">
                    {!skipRequested && !gameData.skipRequests?.includes(socketRef.current?.id) ? (
                      <button
                        onClick={requestSkip}
                        disabled={!connected}
                        className="text-gray-400 hover:text-white text-sm underline transition-all"
                      >
                        Report/Skip this question
                      </button>
                    ) : (
                      <div className="bg-yellow-500/20 rounded-xl p-3 inline-block">
                        <p className="text-yellow-400 text-sm">
                          {skipRequested ? 'You requested to skip this question' : `${gameData.skipRequestedBy || 'Other player'} wants to skip`}
                        </p>
                        {skipRequested && (
                          <button
                            onClick={cancelSkip}
                            className="text-xs text-yellow-300 hover:text-yellow-100 underline mt-1"
                          >
                            Cancel request
                          </button>
                        )}
                      </div>
                    )}
                    
                    {gameData.skipRequests?.length === 2 && (
                      <p className="text-green-400 text-sm mt-2 animate-pulse">
                        Both players agreed - skipping question...
                      </p>
                    )}
                  </div>
                  
                  {(myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)) && (
                    <div className="mt-3">
                      <p className="text-gray-400 text-sm animate-pulse">Waiting for the other player's answer...</p>
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
                    <p className="text-sm text-gray-300 mb-2">Your answer:</p>
                    {(() => {
                      const answerIndex = gameRole === 'challenger' ? parseInt(gameData.challengerAnswer) : parseInt(gameData.moderatorAnswer);
                      const isCorrect = gameRole === 'challenger' ? gameData.challengerCorrect : answerIndex === currentQ.correct;
                      return (
                        <>
                          <p className="text-lg font-bold">{String.fromCharCode(65 + answerIndex)} – {currentQ.options[answerIndex]}</p>
                          <div className="flex justify-center items-center gap-2 mt-2">
                            {isCorrect ? (
                              <><CheckCircle className="text-green-400 w-5 h-5" /><span className="text-green-400 font-bold">Correct! +1 point</span></>
                            ) : (
                              <><XCircle className="text-red-400 w-5 h-5" /><span className="text-red-400 font-bold">Incorrect!</span></>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Game Rules Reminder */}
                  {gameRole === 'challenger' && gameData.challengerCoins <= 2 && (
                    <div className="bg-orange-500/10 backdrop-blur-lg rounded-xl p-3 mb-4 border border-orange-500/30">
                      <div className="flex items-center gap-2">
                        <Coins className="w-4 h-4 text-orange-400" />
                        <p className="text-orange-300 text-xs">
                          <strong>Reminder:</strong> When you doubt, you get your coin back if the moderator is wrong. 
                          Game ends at 0 coins!
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Post-Answer Report Section */}
                  {canReportAfterAnswer && (
                  <div className="mb-4">
                    {gameData.postAnswerReportRequests?.includes(socketRef.current?.id) ? (
                      /* Wenn der aktuelle Spieler bereits gemeldet hat */
                      <div className="bg-orange-500/20 rounded-xl p-3 inline-block">
                        <p className="text-orange-400 text-sm">
                          You reported this question. Waiting for other player...
                        </p>
                        <button
                          onClick={cancelPostAnswerReport}
                          className="text-xs text-orange-300 hover:text-orange-100 underline mt-1"
                        >
                          Cancel report
                        </button>
                      </div>
                    ) : (
                      /* Wenn der aktuelle Spieler noch nicht gemeldet hat */
                      <>
                        <button
                          onClick={requestPostAnswerReport}
                          disabled={!connected}
                          className="text-orange-400 hover:text-orange-200 text-sm underline transition-all"
                        >
                          Report this question as invalid
                        </button>
                        {/* Zeige eine Nachricht an, falls der andere Spieler bereits gemeldet hat */}
                        {gameData.postAnswerReportRequests?.length > 0 && (
                          <p className="text-orange-400 text-xs mt-2">
                            {gameData.postAnswerReportRequestedBy} has already reported this question.
                          </p>
                        )}
                      </>
                    )}

                    {/* Diese Meldung wird für alle angezeigt, wenn beide gemeldet haben */}
                    {gameData.postAnswerReportRequests?.length === 2 && (
                      <p className="text-red-400 text-sm mt-2 animate-pulse">
                        Both players agreed - question invalidated, 0 points for all!
                      </p>
                    )}
                  </div>
                )}
                </div>
                
                {gameRole === 'challenger' ? (
                  <div className="animate-scale-in">
                    <h3 className="text-lg font-bold text-white mb-3">Time for your decision!</h3>
                    <p className="text-gray-300 mb-6 text-sm">{gameData.moderatorName} has also answered.<br/>Do you trust or doubt?</p>
                    <div className="flex gap-3 justify-center">
                      <button onClick={() => makeDecision('trust')} disabled={!connected} className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2">
                        <Heart className="w-4 h-4" /> Trust
                      </button>
                      <button onClick={() => makeDecision('doubt')} disabled={gameData.challengerCoins <= 0 || !connected} className="bg-gradient-to-r from-red-500 to-pink-600 text-white font-bold py-3 px-6 rounded-xl hover:from-red-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2">
                        <Shield className="w-4 h-4" /> 
                        Doubt 
                        <div className="text-xs bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span>-1</span>
                          <Coins className="inline w-3 h-3" />
                        </div>
                      </button>
                    </div>
                    {gameData.challengerCoins <= 0 && <p className="text-red-400 text-sm mt-3 animate-pulse">No more coins to doubt with!</p>}
                  </div>
                ) : (
                  <div className="text-gray-400 animate-pulse">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Waiting for {gameData.challengerName}'s decision...</p>
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
                <h3 className="text-xl font-bold text-white mb-4">Round Result</h3>
                <div className="bg-white/20 rounded-xl p-4 mb-4 space-y-3">
                  <div>
                    <p className="text-sm text-gray-300">Challenger:</p>
                    <p className="font-bold">{String.fromCharCode(65 + parseInt(gameData.challengerAnswer))} - {currentQ.options[parseInt(gameData.challengerAnswer)]} {gameData.challengerCorrect ? <CheckCircle className="inline ml-2 text-green-400 w-4 h-4" /> : <XCircle className="inline ml-2 text-red-400 w-4 h-4" />}</p>
                  </div>
                  {gameData.showModeratorAnswer && (
                    <div className="animate-slide-in">
                      <p className="text-sm text-gray-300">Moderator:</p>
                      <p className="font-bold">{String.fromCharCode(65 + parseInt(gameData.moderatorAnswer))} - {currentQ.options[parseInt(gameData.moderatorAnswer)]} {parseInt(gameData.moderatorAnswer) === currentQ.correct ? <CheckCircle className="inline ml-2 text-green-400 w-4 h-4" /> : <XCircle className="inline ml-2 text-red-400 w-4 h-4" />}</p>
                    </div>
                  )}
                  <div className="pt-3 border-t border-white/30">
                    <p className="text-sm text-gray-300">Correct answer:</p>
                    <p className="text-lg text-green-400 font-bold">{String.fromCharCode(65 + currentQ.correct)} - {currentQ.options[currentQ.correct]}</p>
                  </div>
                </div>
                <div className={`rounded-xl p-4 mb-6 ${gameData.roundResult?.includes('erhält 1 Punkt') ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                  <p className="text-white font-medium">{gameData.roundResult && typeof gameData.roundResult === 'string' ? gameData.roundResult.replace('erhält 1 Punkt', 'gets 1 point').replace('verloren', 'lost').replace('bleibt erhalten', 'is retained') : gameData.roundResult}</p>
                  {gameData.decision === 'doubt' && gameData.roundResult?.includes('verloren') && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-red-400"><TrendingDown className="w-4 h-4" /><span className="text-sm">Lost one coin!</span></div>
                  )}
                  {gameData.decision === 'doubt' && gameData.roundResult?.includes('bleibt erhalten') && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-green-400"><TrendingUp className="w-4 h-4" /><span className="text-sm">Coin saved!</span></div>
                  )}
                </div>
                <button
                  onClick={nextRound}
                  disabled={!connected}
                  className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-8 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  {connected ? 'Next round' : 'Connection lost'}
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
    const isWinner = gameData.winner === (gameRole === 'challenger' ? gameData.challengerName : gameData.moderatorName);
    const isDraw = gameData.winner === 'Unentschieden' || gameData.challengerScore === gameData.moderatorScore;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 relative overflow-hidden">
        {renderConnectionStatus()}
        {renderErrorNotification()}
        {renderFocusWarning()}
        
        {/* Animated Background Effects for Winner */}
        {!isDraw && (
          <>
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(20)].map((_, i) => (
                <Star 
                  key={i}
                  className={`absolute text-yellow-400 animate-ping`}
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${2 + Math.random() * 2}s`
                  }}
                  size={Math.random() * 20 + 10}
                />
              ))}
            </div>

            <div className="absolute inset-0 pointer-events-none">
              {[...Array(15)].map((_, i) => (
                <Sparkles 
                  key={i}
                  className="absolute text-yellow-300 animate-bounce"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 3}s`,
                    animationDuration: `${1 + Math.random()}s`
                  }}
                  size={Math.random() * 15 + 8}
                />
              ))}
            </div>
          </>
        )}
        
        <div className="max-w-md mx-auto pt-8 relative z-10">
          <div className="text-center mb-8 animate-fade-in">
            {/* Winner Trophy Animation */}
            <div className="relative mb-6">
              <Trophy 
                className={`text-yellow-400 w-24 h-24 mx-auto mb-4 ${!isDraw ? 'animate-bounce' : 'animate-pulse'}`} 
              />
              
              {/* Pulsing rings around trophy for winner */}
              {!isDraw && (
                <>
                  <div className="absolute inset-0 w-24 h-24 mx-auto rounded-full border-4 border-yellow-400 animate-ping opacity-30"></div>
                  <div className="absolute inset-0 w-32 h-32 mx-auto rounded-full border-2 border-yellow-300 animate-ping opacity-20" style={{animationDelay: '0.5s'}}></div>
                </>
              )}
            </div>
            
            <h1 className="text-3xl font-bold text-white mb-2">Game Over!</h1>
            
            {/* Winner Celebration Text */}
            {!isDraw && (
              <div className="mb-4">
                <div className="text-6xl mb-2 animate-bounce">🎉</div>
                <p className="text-yellow-400 text-lg font-bold animate-pulse">
                  Congratulations!
                </p>
              </div>
            )}
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-center animate-scale-in">
            <h2 className="text-2xl font-bold text-white mb-6">
              {isDraw ? (
                <span className="text-gray-400 animate-pulse">It's a draw!</span>
              ) : (
                <div className="space-y-2">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400 animate-pulse">
                    {gameData.winner} wins!
                  </span>
                  {isWinner && (
                    <div className="text-green-400 text-lg animate-bounce">
                      🏆 That's you! 🏆
                    </div>
                  )}
                </div>
              )}
            </h2>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className={`bg-white/20 rounded-xl p-4 transform transition-all ${
                gameData.winner === gameData.challengerName ? 'ring-4 ring-yellow-400 scale-105 animate-pulse' : ''
              }`}>
                <Zap className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                <h3 className="font-bold text-white">{gameData.challengerName}</h3>
                <p className={`text-2xl font-bold ${
                  gameData.winner === gameData.challengerName ? 'text-yellow-400' : 'text-blue-400'
                }`}>
                  {gameData.challengerScore}
                </p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Coins className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-gray-300">{gameData.challengerCoins} left</span>
                </div>
                {gameData.winner === gameData.challengerName && (
                  <div className="mt-2 text-yellow-400 text-sm font-bold animate-bounce">
                    🎉 WINNER! 🎉
                  </div>
                )}
              </div>
              
              <div className={`bg-white/20 rounded-xl p-4 transform transition-all ${
                gameData.winner === gameData.moderatorName ? 'ring-4 ring-yellow-400 scale-105 animate-pulse' : ''
              }`}>
                <Shield className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                <h3 className="font-bold text-white">{gameData.moderatorName}</h3>
                <p className={`text-2xl font-bold ${
                  gameData.winner === gameData.moderatorName ? 'text-yellow-400' : 'text-purple-400'
                }`}>
                  {gameData.moderatorScore}
                </p>
                <p className="text-sm text-gray-300 mt-1">Moderator</p>
                {gameData.winner === gameData.moderatorName && (
                  <div className="mt-2 text-yellow-400 text-sm font-bold animate-bounce">
                    🎉 WINNER! 🎉
                  </div>
                )}
              </div>
            </div>
            
            {/* Game End Reason */}
            <div className="mb-6">
              {gameData.challengerScore >= 5 && (
                <div className="bg-blue-500/20 rounded-xl p-3 mb-4">
                  <p className="text-blue-400 text-sm flex items-center justify-center gap-2">
                    <Trophy className="w-4 h-4" /> {gameData.challengerName} reached 5 points!
                  </p>
                </div>
              )}
              {gameData.moderatorScore >= 5 && (
                <div className="bg-purple-500/20 rounded-xl p-3 mb-4">
                  <p className="text-purple-400 text-sm flex items-center justify-center gap-2">
                    <Trophy className="w-4 h-4" /> {gameData.moderatorName} reached 5 points!
                  </p>
                </div>
              )}
              {gameData.challengerCoins <= 0 && (
                <div className="bg-red-500/20 rounded-xl p-3 mb-4">
                  <p className="text-red-400 text-sm flex items-center justify-center gap-2">
                    <Coins className="w-4 h-4" /> The challenger ran out of coins!
                  </p>
                </div>
              )}
            </div>
            
            {/* Game Statistics */}
            <div className="bg-white/10 rounded-xl p-4 mb-6">
              <h3 className="text-white font-bold mb-3">Game Statistics</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-400">Total Rounds</p>
                  <p className="text-white font-bold">{gameData.currentQuestion + 1}</p>
                </div>
                <div>
                  <p className="text-gray-400">Final Coins</p>
                  <p className="text-yellow-400 font-bold">{gameData.challengerCoins}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  clearAllSessionData();
                  if (socketRef.current) {
                    socketRef.current.disconnect();
                    socketRef.current = null;
                  }
                  window.location.reload();
                }}
                className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95"
              >
                🎮 Play Again
              </button>
              
              <button
                onClick={() => {
                  const resultText = isDraw 
                    ? `Just played Trust or Doubt and it was a draw! ${gameData.challengerScore}-${gameData.moderatorScore}`
                    : `Just played Trust or Doubt as ${gameRole === 'challenger' ? 'challenger' : 'moderator'} and ${isWinner ? 'won' : 'lost'}! Final score: ${gameData.challengerScore}-${gameData.moderatorScore}`;
                  
                  if (navigator.share) {
                    navigator.share({
                      title: 'Trust or Doubt - Game Result',
                      text: resultText,
                      url: window.location.href
                    });
                  } else {
                    navigator.clipboard?.writeText(`${resultText} ${window.location.href}`);
                  }
                }}
                className="w-full bg-white/20 text-white font-bold py-2 px-6 rounded-xl hover:bg-white/30 transition-all"
              >
                📤 Share Result
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
            <h2 className="text-2xl font-bold text-white mb-4">Game Paused</h2>
            <p className="text-gray-300 mb-6">{connectionError || 'Connection issues detected'}</p>
            <div className="space-y-3">
              <button
                onClick={retryConnection}
                disabled={reconnecting}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-6 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {reconnecting ? 'Connecting...' : 'Reconnect'}
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="w-full bg-white/20 text-white font-bold py-2 px-6 rounded-xl hover:bg-white/30 transition-all"
              >
                Back to Main Menu
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
        <p className="text-white text-xl">Connecting to server...</p>
      </div>
    </div>
  );
};

export default QuizGame;
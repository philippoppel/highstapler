import React, { useState, useEffect } from 'react';
import { Trophy, Coins, Users, HelpCircle, CheckCircle, XCircle, Wifi, WifiOff, AlertCircle, Sparkles, Heart, Shield, Zap, Star, TrendingUp, TrendingDown } from 'lucide-react';
import io from 'socket.io-client';

// Socket-Verbindung (ändere URL für Production)
const SOCKET_URL = 'http://192.168.178.156:3001';
let socket = null;

const QuizGame = () => {
  // Verbindungsstatus
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  
  // Spielzustand
  const [gameState, setGameState] = useState('menu');
  const [gameId, setGameId] = useState('');
  const [playerRole, setPlayerRole] = useState(''); // host oder player2
  const [gameRole, setGameRole] = useState(''); // challenger oder moderator
  const [gameData, setGameData] = useState({});
  
  // Spielername
  const [playerName, setPlayerName] = useState('');
  const [joinGameId, setJoinGameId] = useState('');
  
  // Lokale UI-States
  const [myAnswer, setMyAnswer] = useState('');
  const [myAnswered, setMyAnswered] = useState(false);
  const [animateScore, setAnimateScore] = useState(false);
  const [animateCoins, setAnimateCoins] = useState(false);
  const [showDecisionAnimation, setShowDecisionAnimation] = useState(false);
  const [alreadyReconnected, setAlreadyReconnected] = useState(false);

  useEffect(() => {
    const savedGameId = sessionStorage.getItem('gameId');
    const savedPlayerName = sessionStorage.getItem('playerName');
  
    if (savedGameId && savedPlayerName && connected && !alreadyReconnected) {
      console.log('Attempting to reconnect to game:', savedGameId);
      setPlayerName(savedPlayerName);
      setJoinGameId(savedGameId);
  
      setAlreadyReconnected(true);
  
      setTimeout(() => {
        socket.emit('join-game', {
          gameId: savedGameId,
          playerName: savedPlayerName
        });
      }, 1000);
    }
  }, [connected, alreadyReconnected]);
  

  // Socket.io Verbindung initialisieren
  useEffect(() => {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });
  
    socket.on('connect', () => {
      console.log('Verbunden mit Server');
      setConnected(true);
      setConnectionError('');
    });
  
    socket.on('disconnect', () => {
      console.log('Verbindung getrennt');
      setConnected(false);
    });
  
    socket.on('connect_error', (error) => {
      console.error('Verbindungsfehler:', error);
      setConnectionError('Keine Verbindung zum Server möglich');
    });
  
    // Game Events
    socket.on('game-created', (data) => {
      console.log('Game created event:', data);
      setGameId(data.gameId);
      setGameData(data.game);
      setGameState('lobby');
      setPlayerRole('host');
      sessionStorage.setItem('gameId', data.gameId);
    });
  
    socket.on('joined-game', (data) => {
      console.log('Joined game event:', data);
      setGameId(data.gameId);
      setPlayerRole(data.role);
      if (data.gameRole) {
        setGameRole(data.gameRole);
      }
    });
  
    socket.on('game-updated', (game) => {
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
  
      const myPlayer = game.players?.find(p => p.id === socket.id);
      if (myPlayer && myPlayer.gameRole) {
        setGameRole(myPlayer.gameRole);
      }
  
      if (game.phase === 'answering' && game.challengerAnswered === false && game.moderatorAnswered === false) {
        setMyAnswer('');
        setMyAnswered(false);
      }
  
      if (game.phase === 'result' && gameData.phase === 'decision') {
        setShowDecisionAnimation(true);
        setTimeout(() => setShowDecisionAnimation(false), 2000);
      }
  
      if (game.state === 'finished') {
        sessionStorage.removeItem('gameId');
        sessionStorage.removeItem('playerName');
      }
    });
  
    socket.on('game-started', (game) => {
      console.log('Game started:', game);
      setGameData(game);
      setGameState('playing');
    });
  
    socket.on('game-paused', (game) => {
      setGameData(game);
      alert('Ein Spieler hat das Spiel verlassen. Spiel pausiert.');
    });
  
    socket.on('player-disconnected', (data) => {
      alert(`${data.playerName} hat das Spiel verlassen.`);
    });
  
    socket.on('error', (data) => {
      alert(data.message);
    });
  
    return () => {
      socket.disconnect();
    };
  }, []); // ← GANZ WICHTIG: leeres Dependency-Array!
  

  // Spiel erstellen
  const createGame = () => {
    if (!playerName.trim()) return;
    
    // Speichere Spielername
    sessionStorage.setItem('playerName', playerName);
    
    socket.emit('create-game', {
      playerName,
      questions: []
    });
  };

  // Spiel beitreten
  const joinGame = () => {
    if (!joinGameId.trim() || !playerName.trim()) return;
    
    // Speichere Spieldaten
    sessionStorage.setItem('gameId', joinGameId.toUpperCase());
    sessionStorage.setItem('playerName', playerName);
    
    socket.emit('join-game', {
      gameId: joinGameId.toUpperCase(),
      playerName
    });
  };

  // Spiel starten
  const startGame = () => {
    socket.emit('start-game', { gameId });
  };

  // Antwort abgeben
  const submitAnswer = () => {
    if (!myAnswer || myAnswered) return;
    
    setMyAnswered(true);
    socket.emit('submit-answer', {
      gameId,
      answer: myAnswer
    });
  };

  // Entscheidung treffen
  const makeDecision = (decision) => {
    socket.emit('make-decision', {
      gameId,
      decision
    });
  };

  // Nächste Runde
  const nextRound = () => {
    socket.emit('next-round', { gameId });
  };

  // Render-Funktionen
  const renderConnectionStatus = () => (
    <div className={`fixed top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all ${
      connected ? 'bg-green-500/20 backdrop-blur' : 'bg-red-500/20 backdrop-blur'
    }`}>
      {connected ? (
        <>
          <Wifi className="w-3 h-3 text-green-400" />
          <span className="text-green-400">Online</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3 text-red-400" />
          <span className="text-red-400">Offline</span>
        </>
      )}
    </div>
  );

  // Menu Screen
  if (gameState === 'menu') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
        {renderConnectionStatus()}
        
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
          
          {connectionError && (
            <div className="bg-red-500/20 backdrop-blur border border-red-500/50 rounded-xl p-4 mb-6 flex items-center gap-2 animate-shake">
              <AlertCircle className="text-red-400 w-5 h-5 flex-shrink-0" />
              <span className="text-red-400 text-sm">{connectionError}</span>
            </div>
          )}
          
          <div className="space-y-4">
            {/* Spiel erstellen */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Users className="text-blue-400" />
                Neues Spiel
              </h2>
              
              <div className="space-y-4">
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-blue-400 focus:outline-none transition-all"
                  placeholder="Dein Name"
                  maxLength={15}
                />
                
                <button
                  onClick={createGame}
                  disabled={!playerName.trim() || !connected}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-6 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  Spiel erstellen
                </button>
              </div>
            </div>
            
            {/* Spiel beitreten */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Wifi className="text-green-400" />
                Spiel beitreten
              </h2>
              
              <div className="space-y-4">
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-green-400 focus:outline-none transition-all"
                  placeholder="Dein Name"
                  maxLength={15}
                />
                
                <input
                  type="text"
                  value={joinGameId}
                  onChange={(e) => setJoinGameId(e.target.value.toUpperCase())}
                  className="w-full p-3 rounded-xl bg-white/20 text-white placeholder-gray-300 border border-white/30 focus:border-green-400 focus:outline-none transition-all font-mono text-center text-lg"
                  placeholder="SPIELCODE"
                  maxLength={6}
                />
                
                <button
                  onClick={joinGame}
                  disabled={!playerName.trim() || !joinGameId.trim() || !connected}
                  className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                >
                  Beitreten
                </button>
              </div>
            </div>
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
        
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Warte auf Spieler...</h1>
            <p className="text-gray-300 text-sm">Teile diesen Code:</p>
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 mb-6 animate-scale-in">
            <div className="text-center">
              <div className="text-5xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-4 animate-pulse">
                {gameId}
              </div>
              <p className="text-gray-300 text-sm">Spielcode</p>
            </div>
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Spieler im Raum:</h3>
            <div className="space-y-2">
              {gameData.players?.map((player, index) => (
                <div key={index} className="flex items-center gap-3 bg-white/20 rounded-xl p-3 animate-slide-in" style={{animationDelay: `${index * 100}ms`}}>
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-white font-medium flex-1">{player.name}</span>
                  {player.role === 'host' && (
                    <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-1 rounded-full">Host</span>
                  )}
                </div>
              ))}
              
              {gameData.players?.length === 1 && (
                <div className="flex items-center gap-3 bg-white/10 rounded-xl p-3 border-2 border-dashed border-white/30">
                  <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
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
        
        <div className="max-w-md mx-auto pt-8">
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Rollen werden verteilt...</h1>
            <p className="text-gray-300 text-sm">Das Schicksal entscheidet!</p>
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 space-y-4 animate-scale-in">
            <div className={`bg-gradient-to-r from-blue-500/20 to-blue-600/20 rounded-xl p-4 text-center transform transition-all ${
              gameData.challengerName ? 'scale-100 opacity-100' : 'scale-95 opacity-50'
            }`}>
              <div className="flex justify-center mb-2">
                <Zap className="w-8 h-8 text-blue-400 animate-pulse" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Herausforderer</h3>
              <p className="text-2xl font-bold text-blue-400">{gameData.challengerName || '...'}</p>
              <p className="text-gray-300 text-sm mt-2">Beantwortet Fragen & trifft Entscheidungen</p>
              <div className="mt-3 flex items-center justify-center gap-1">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-400 font-bold">{gameData.initialCoins} Münzen zum Start</span>
              </div>
            </div>
            
            <div className={`bg-gradient-to-r from-purple-500/20 to-purple-600/20 rounded-xl p-4 text-center transform transition-all ${
              gameData.moderatorName ? 'scale-100 opacity-100' : 'scale-95 opacity-50'
            }`}>
              <div className="flex justify-center mb-2">
                <Shield className="w-8 h-8 text-purple-400 animate-pulse" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Moderator</h3>
              <p className="text-2xl font-bold text-purple-400">{gameData.moderatorName || '...'}</p>
              <p className="text-gray-300 text-sm mt-2">Beantwortet Fragen & sammelt Vertrauen</p>
            </div>
            
            <div className="text-center pt-4">
              <p className="text-xs text-gray-400 mb-2">Debug: Role={playerRole}, GameRole={gameRole}</p>
              {playerRole === 'host' ? (
                <button
                  onClick={startGame}
                  className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-8 rounded-xl hover:from-green-600 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95"
                >
                  Spiel starten
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
    if (!currentQ) return <div className="text-white">Laden...</div>;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 pb-20">
        {renderConnectionStatus()}
        
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-4 pt-4">
            <h1 className="text-2xl font-bold text-white">Vertrauen oder Zweifeln</h1>
          </div>

          {/* Spieler Status Cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className={`bg-white/10 backdrop-blur-lg rounded-xl p-3 transform transition-all ${
              gameRole === 'challenger' ? 'ring-2 ring-blue-400 scale-105' : ''
            } ${animateScore && gameRole === 'challenger' ? 'animate-bounce' : ''}`}>
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
            
            <div className={`bg-white/10 backdrop-blur-lg rounded-xl p-3 transform transition-all ${
              gameRole === 'moderator' ? 'ring-2 ring-purple-400 scale-105' : ''
            }`}>
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
            <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-500" 
                 style={{width: `${Math.max(gameData.challengerScore, gameData.moderatorScore) * 20}%`}}>
            </div>
          </div>

          {/* Aktuelle Frage */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6">
            <h2 className="text-xl font-bold text-white mb-4 text-center">{currentQ.question}</h2>
            
            {gameData.phase === 'answering' && (
              <div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {currentQ.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => setMyAnswer(index.toString())}
                      disabled={myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)}
                      className={`p-3 rounded-xl border-2 transition-all transform hover:scale-105 active:scale-95 ${
                        myAnswer === index.toString()
                          ? 'border-blue-400 bg-blue-400/20 text-white'
                          : 'border-white/30 bg-white/10 text-gray-300 hover:border-white/50 hover:bg-white/20'
                      } ${(myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className="font-bold text-sm">{String.fromCharCode(65 + index)}) {option}</span>
                    </button>
                  ))}
                </div>
                
                <div className="text-center">
                  <button
                    onClick={submitAnswer}
                    disabled={!myAnswer || myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)}
                    className="bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold py-3 px-8 rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                  >
                    {(myAnswered || (gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered)) ? 'Antwort abgegeben' : 'Antwort abgeben'}
                  </button>
                  
                  {(gameRole === 'challenger' ? gameData.challengerAnswered : gameData.moderatorAnswered) && (
                    <p className="text-gray-400 mt-3 text-sm animate-pulse">Warte auf die Antwort des anderen Spielers...</p>
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
      const answerIndex = gameRole === 'challenger'
        ? parseInt(gameData.challengerAnswer)
        : parseInt(gameData.moderatorAnswer);

      const isCorrect = gameRole === 'challenger'
        ? gameData.challengerCorrect
        : answerIndex === currentQ.correct;

      return (
        <>
          <p className="text-lg font-bold">
            {String.fromCharCode(65 + answerIndex)} – {currentQ.options[answerIndex]}
          </p>

          <div className="flex justify-center items-center gap-2 mt-2">
            {isCorrect ? (
              <>
                <CheckCircle className="text-green-400 w-5 h-5" />
                <span className="text-green-400 font-bold">Richtig! +1 Punkt</span>
              </>
            ) : (
              <>
                <XCircle className="text-red-400 w-5 h-5" />
                <span className="text-red-400 font-bold">Falsch!</span>
              </>
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
                    <p className="text-gray-300 mb-6 text-sm">
                      {gameData.moderatorName} hat auch geantwortet.<br/>
                      Vertraust du oder zweifelst du?
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => makeDecision('trust')}
                        className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2"
                      >
                        <Heart className="w-4 h-4" />
                        Vertrauen
                      </button>
                      <button
                        onClick={() => makeDecision('doubt')}
                        disabled={gameData.challengerCoins <= 0}
                        className="bg-gradient-to-r from-red-500 to-pink-600 text-white font-bold py-3 px-6 rounded-xl hover:from-red-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2"
                      >
                        <Shield className="w-4 h-4" />
                        Zweifeln
                        <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">-1 <Coins className="inline w-3 h-3" /></span>
                      </button>
                    </div>
                    {gameData.challengerCoins <= 0 && (
                      <p className="text-red-400 text-sm mt-3 animate-pulse">Keine Münzen mehr zum Zweifeln!</p>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-400 animate-pulse">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Warte auf die Entscheidung von {gameData.challengerName}...</p>
                  </div>
                )}
                {/* Challenger sieht Antwort des Moderators nur bei Zweifel */}
                {gameRole === 'challenger' && gameData.showModeratorAnswer && (
                  <div className="mt-6 bg-white/10 rounded-xl p-4 text-center animate-fade-in">
                    <p className="text-sm text-gray-300 mb-1">Antwort von {gameData.moderatorName}:</p>
                    <p className="text-lg font-bold">
                      {String.fromCharCode(65 + parseInt(gameData.moderatorAnswer))} - {currentQ.options[parseInt(gameData.moderatorAnswer)]}
                    </p>
                  </div>
                )}
              </div>
            )}
            
            {gameData.phase === 'result' && (
              <div className="text-center animate-fade-in">
                {showDecisionAnimation && (
                  <div className="mb-4 animate-bounce">
                    {gameData.decision === 'trust' ? (
                      <Heart className="w-16 h-16 text-green-400 mx-auto" />
                    ) : (
                      <Shield className="w-16 h-16 text-red-400 mx-auto" />
                    )}
                  </div>
                )}
                
                <h3 className="text-xl font-bold text-white mb-4">Rundenergebnis</h3>
                
                <div className="bg-white/20 rounded-xl p-4 mb-4 space-y-3">
                  <div>
                    <p className="text-sm text-gray-300">Herausforderer:</p>
                    <p className="font-bold">
                      {String.fromCharCode(65 + parseInt(gameData.challengerAnswer))} - {currentQ.options[parseInt(gameData.challengerAnswer)]}
                      {gameData.challengerCorrect ? 
                        <CheckCircle className="inline ml-2 text-green-400 w-4 h-4" /> : 
                        <XCircle className="inline ml-2 text-red-400 w-4 h-4" />
                      }
                    </p>
                  </div>
                  
                  {gameData.showModeratorAnswer && (
                    <div className="animate-slide-in">
                      <p className="text-sm text-gray-300">Moderator:</p>
                      <p className="font-bold">
                        {String.fromCharCode(65 + parseInt(gameData.moderatorAnswer))} - {currentQ.options[parseInt(gameData.moderatorAnswer)]}
                        {parseInt(gameData.moderatorAnswer) === currentQ.correct ? 
                          <CheckCircle className="inline ml-2 text-green-400 w-4 h-4" /> : 
                          <XCircle className="inline ml-2 text-red-400 w-4 h-4" />
                        }
                      </p>
                    </div>
                  )}
                  
                  <div className="pt-3 border-t border-white/30">
                    <p className="text-sm text-gray-300">Richtige Antwort:</p>
                    <p className="text-lg text-green-400 font-bold">
                      {String.fromCharCode(65 + currentQ.correct)} - {currentQ.options[currentQ.correct]}
                    </p>
                  </div>
                </div>
                
                <div className={`rounded-xl p-4 mb-6 ${
                  gameData.roundResult?.includes('erhält 1 Punkt') ? 'bg-blue-500/20' : 'bg-purple-500/20'
                }`}>
                  <p className="text-white font-medium">{gameData.roundResult}</p>
                  {gameData.decision === 'doubt' && gameData.roundResult?.includes('verloren') && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-red-400">
                      <TrendingDown className="w-4 h-4" />
                      <span className="text-sm">Eine Münze verloren!</span>
                    </div>
                  )}
                </div>
                
                <button
                  onClick={nextRound}
                  className="bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-8 rounded-xl hover:from-green-600 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95"
                >
                  Nächste Runde
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
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400">
                  {gameData.winner} gewinnt!
                </span>
              )}
            </h2>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white/20 rounded-xl p-4">
                <Zap className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                <h3 className="font-bold text-white">{gameData.challengerName}</h3>
                <p className="text-2xl text-blue-400 font-bold">{gameData.challengerScore}</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Coins className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-gray-300">{gameData.challengerCoins} übrig</span>
                </div>
              </div>
              
              <div className="bg-white/20 rounded-xl p-4">
                <Shield className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                <h3 className="font-bold text-white">{gameData.moderatorName}</h3>
                <p className="text-2xl text-purple-400 font-bold">{gameData.moderatorScore}</p>
                <p className="text-sm text-gray-300 mt-1">Moderator</p>
              </div>
            </div>
            
            {gameData.challengerCoins <= 0 && gameData.winner === gameData.moderatorName && (
              <div className="bg-red-500/20 rounded-xl p-3 mb-4">
                <p className="text-red-400 text-sm flex items-center justify-center gap-2">
                  <Coins className="w-4 h-4" />
                  Herausforderer hat alle Münzen verloren!
                </p>
              </div>
            )}
            
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white font-bold py-3 px-6 rounded-xl hover:from-green-600 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95"
            >
              Neues Spiel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <div className="text-white">Laden...</div>;
};

export default QuizGame;
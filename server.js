const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'Server läuft!', timestamp: new Date().toISOString() });
  });

// Spiel-Storage
const games = new Map();
const players = new Map();

// Erweiterte Fragendatenbank
const questionDatabase = [
  // Geografie
  { question: "Welches ist das kleinste Land der Welt?", options: ["Monaco", "Vatikanstadt", "San Marino", "Liechtenstein"], correct: 1, category: "Geografie" },
  { question: "Wie heißt die Hauptstadt von Island?", options: ["Oslo", "Reykjavik", "Helsinki", "Stockholm"], correct: 1, category: "Geografie" },
  { question: "Welcher ist der längste Fluss Europas?", options: ["Donau", "Rhein", "Wolga", "Seine"], correct: 2, category: "Geografie" },
  { question: "Wie viele Zeitzonen gibt es in Russland?", options: ["7", "9", "11", "13"], correct: 2, category: "Geografie" },
  { question: "Welches Land hat die meisten Inseln?", options: ["Indonesien", "Schweden", "Kanada", "Japan"], correct: 1, category: "Geografie" },
  
  // Geschichte
  { question: "In welchem Jahr wurde die UNO gegründet?", options: ["1943", "1945", "1947", "1949"], correct: 1, category: "Geschichte" },
  { question: "Wer war der erste Mensch im Weltraum?", options: ["Neil Armstrong", "Buzz Aldrin", "Juri Gagarin", "Alan Shepard"], correct: 2, category: "Geschichte" },
  { question: "Wie lange dauerte der Hundertjährige Krieg?", options: ["100 Jahre", "116 Jahre", "99 Jahre", "124 Jahre"], correct: 1, category: "Geschichte" },
  { question: "Welches war das erste Land mit Frauenwahlrecht?", options: ["USA", "Neuseeland", "Schweiz", "England"], correct: 1, category: "Geschichte" },
  { question: "In welchem Jahr endete der Erste Weltkrieg?", options: ["1916", "1917", "1918", "1919"], correct: 2, category: "Geschichte" },
  
  // Wissenschaft
  { question: "Wie viele Knochen hat ein erwachsener Mensch?", options: ["186", "206", "226", "246"], correct: 1, category: "Wissenschaft" },
  { question: "Was ist die häufigste Blutgruppe?", options: ["A+", "B+", "O+", "AB+"], correct: 2, category: "Wissenschaft" },
  { question: "Welches ist das leichteste Element?", options: ["Helium", "Wasserstoff", "Lithium", "Beryllium"], correct: 1, category: "Wissenschaft" },
  { question: "Wie viel Prozent der Erde sind mit Wasser bedeckt?", options: ["61%", "71%", "81%", "91%"], correct: 1, category: "Wissenschaft" },
  { question: "Was ist die Schallgeschwindigkeit?", options: ["343 m/s", "443 m/s", "543 m/s", "643 m/s"], correct: 0, category: "Wissenschaft" },
  
  // Kultur & Unterhaltung
  { question: "Wer komponierte 'Die Zauberflöte'?", options: ["Beethoven", "Bach", "Mozart", "Händel"], correct: 2, category: "Kultur" },
  { question: "Wie viele Harry Potter Filme gibt es?", options: ["6", "7", "8", "9"], correct: 2, category: "Kultur" },
  { question: "In welchem Jahr wurde Netflix gegründet?", options: ["1995", "1997", "1999", "2001"], correct: 1, category: "Kultur" },
  { question: "Wer malte 'Die Sternennacht'?", options: ["Monet", "Van Gogh", "Picasso", "Dalí"], correct: 1, category: "Kultur" },
  { question: "Wie viele Saiten hat eine klassische Gitarre?", options: ["4", "5", "6", "7"], correct: 2, category: "Kultur" },
  
  // Sport
  { question: "Wie viele Spieler sind in einer Volleyball-Mannschaft?", options: ["4", "5", "6", "7"], correct: 2, category: "Sport" },
  { question: "In welchem Land wurden die Olympischen Spiele erfunden?", options: ["Italien", "Griechenland", "Frankreich", "England"], correct: 1, category: "Sport" },
  { question: "Wie lang ist ein Marathon?", options: ["40,195 km", "41,195 km", "42,195 km", "43,195 km"], correct: 2, category: "Sport" },
  { question: "Welche Sportart heißt auch 'Königin der Sportarten'?", options: ["Fußball", "Tennis", "Leichtathletik", "Schwimmen"], correct: 2, category: "Sport" },
  { question: "Wie viele Punkte ist ein Touchdown wert?", options: ["5", "6", "7", "8"], correct: 1, category: "Sport" },
  
  // Allgemeinwissen
  { question: "Wie viele Zähne hat ein erwachsener Mensch normalerweise?", options: ["28", "30", "32", "34"], correct: 2, category: "Allgemein" },
  { question: "Was ist die meistgesprochene Sprache der Welt?", options: ["Englisch", "Mandarin", "Spanisch", "Hindi"], correct: 1, category: "Allgemein" },
  { question: "Wie viele Herzen hat ein Oktopus?", options: ["1", "2", "3", "4"], correct: 2, category: "Allgemein" },
  { question: "Welches Tier schläft am wenigsten?", options: ["Giraffe", "Elefant", "Delfin", "Pferd"], correct: 0, category: "Allgemein" },
  { question: "Was bedeutet 'www'?", options: ["World Wide Web", "World Web Wide", "Web World Wide", "Wide World Web"], correct: 0, category: "Allgemein" }
];

// Hilfsfunktionen
const generateGameId = () => {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
};

const getRandomQuestions = (count = 10) => {
  const shuffled = [...questionDatabase].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

const getRandomCoins = () => {
  return Math.floor(Math.random() * 3) + 1; // 1-3 Münzen
};

// Socket.io Events
io.on('connection', (socket) => {
  console.log('Neuer Spieler verbunden:', socket.id);

  // Spiel erstellen
  socket.on('create-game', (data) => {
    console.log('CREATE GAME:', data);
    const gameId = generateGameId();
    const initialCoins = getRandomCoins();
    
    const game = {
      id: gameId,
      hostId: socket.id,
      hostName: data.playerName,
      players: [{
        id: socket.id,
        name: data.playerName,
        role: 'host',
        isHost: true,
        connected: true,
        lastSeen: Date.now()
      }],
      questions: getRandomQuestions(30),
      currentQuestion: 0,
      state: 'lobby',
      challengerScore: 0,
      moderatorScore: 0,
      challengerCoins: initialCoins,
      initialCoins: initialCoins,
      challengerName: '',
      moderatorName: '',
      phase: 'answering',
      challengerAnswer: '',
      moderatorAnswer: '',
      challengerAnswered: false,
      moderatorAnswered: false,
      challengerCorrect: false,
      decision: '',
      roundResult: '',
      showModeratorAnswer: false,
      winner: '',
      usedQuestions: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    games.set(gameId, game);
    players.set(socket.id, { gameId, role: 'host', isHost: true, playerName: data.playerName });
    
    socket.join(gameId);
    socket.emit('game-created', { gameId, game });
    console.log('Game created:', gameId, 'by', data.playerName, 'with', initialCoins, 'coins');
  });

  // Spiel beitreten
  socket.on('join-game', (data) => {
    console.log('JOIN GAME:', data);
    const { gameId, playerName } = data;
    const game = games.get(gameId.toUpperCase()); // Sicherstellen dass GameID uppercase ist

    if (!game) {
      console.log('Game not found:', gameId);
      socket.emit('error', { message: 'Spiel nicht gefunden!' });
      return;
    }

    // Überprüfe ob Spieler reconnect
    const existingPlayer = game.players.find(p => p.name === playerName);
    
    if (existingPlayer) {
      // Reconnect
      console.log('Player reconnecting:', playerName);
      existingPlayer.id = socket.id;
      existingPlayer.connected = true;
      existingPlayer.lastSeen = Date.now();
      
      players.set(socket.id, { 
        gameId, 
        role: existingPlayer.role, 
        isHost: existingPlayer.isHost,
        playerName: playerName 
      });
      
      socket.join(gameId);
      
      // Update Host ID wenn nötig
      if (existingPlayer.isHost) {
        game.hostId = socket.id;
      }
      
      // Update Spieler IDs für Challenger/Moderator
      if (game.challengerName === playerName) {
        game.challengerId = socket.id;
      }
      if (game.moderatorName === playerName) {
        game.moderatorId = socket.id;
      }
      
      // Sende aktuellen Spielstand
      socket.emit('joined-game', { 
        gameId, 
        role: existingPlayer.role,
        isHost: existingPlayer.isHost,
        gameRole: existingPlayer.gameRole
      });
      
      io.to(gameId).emit('game-updated', game);
      return;
    }

    if (game.players.length >= 2) {
      console.log('Game full:', gameId);
      socket.emit('error', { message: 'Spiel ist bereits voll!' });
      return;
    }

    // Neuer Spieler
    game.players.push({
      id: socket.id,
      name: playerName,
      role: 'player2',
      isHost: false,
      connected: true,
      lastSeen: Date.now()
    });

    players.set(socket.id, { gameId, role: 'player2', isHost: false, playerName: playerName });
    socket.join(gameId);

    // Rollen zuweisen wenn 2 Spieler
    if (game.players.length === 2) {
      // Rollen zufällig verteilen
      if (Math.random() < 0.5) {
        game.challengerName = game.players[0].name;
        game.moderatorName = game.players[1].name;
        game.challengerId = game.players[0].id;
        game.moderatorId = game.players[1].id;
        game.players[0].gameRole = 'challenger';
        game.players[1].gameRole = 'moderator';
      } else {
        game.challengerName = game.players[1].name;
        game.moderatorName = game.players[0].name;
        game.challengerId = game.players[1].id;
        game.moderatorId = game.players[0].id;
        game.players[1].gameRole = 'challenger';
        game.players[0].gameRole = 'moderator';
      }
      game.state = 'setup';
      console.log('Roles assigned - Challenger:', game.challengerName, 'Moderator:', game.moderatorName);
    }

    game.lastActivity = Date.now();

    // Update an alle Spieler senden
    io.to(gameId).emit('game-updated', game);
    
    // Dem beitretenden Spieler seine Rolle mitteilen
    const joinedPlayer = game.players.find(p => p.id === socket.id);
    socket.emit('joined-game', { 
      gameId, 
      role: joinedPlayer.role,
      isHost: joinedPlayer.isHost,
      gameRole: joinedPlayer.gameRole
    });
    
    console.log('Player joined:', playerName, 'to game:', gameId);
  });

  // Spiel starten
  socket.on('start-game', (data) => {
    console.log('START GAME:', data);
    const { gameId } = data;
    const game = games.get(gameId);

    if (!game) {
      console.log('Game not found for start:', gameId);
      return;
    }

    const playerInfo = players.get(socket.id);
    if (!playerInfo || !playerInfo.isHost) {
      console.log('Non-host tried to start game:', socket.id);
      return;
    }

    game.state = 'playing';
    game.phase = 'answering';
    game.currentQuestion = 0;
    game.lastActivity = Date.now();

    console.log('Game started:', gameId);
    io.to(gameId).emit('game-started', game);
  });

  // Antwort abgeben
  socket.on('submit-answer', (data) => {
    console.log('SUBMIT ANSWER:', data);
    const { gameId, answer } = data;
    const game = games.get(gameId);
    
    if (!game) {
      console.log('Game not found for answer:', gameId);
      return;
    }
    
    const player = game.players.find(p => p.id === socket.id);
    if (!player) {
      console.log('Player not found:', socket.id);
      return;
    }

    console.log('Player role:', player.gameRole, 'Answer:', answer);

    if (player.gameRole === 'challenger' || (player.isHost && game.challengerId === socket.id)) {
      game.challengerAnswer = answer;
      game.challengerAnswered = true;
      console.log('Challenger answered');
    } else if (player.gameRole === 'moderator' || (player.isHost && game.moderatorId === socket.id)) {
      game.moderatorAnswer = answer;
      game.moderatorAnswered = true;
      console.log('Moderator answered');
    }

    game.lastActivity = Date.now();

    // Prüfen ob beide geantwortet haben
    if (game.challengerAnswered && game.moderatorAnswered) {
      const currentQ = game.questions[game.currentQuestion];
      game.challengerCorrect = parseInt(game.challengerAnswer) === currentQ.correct;
      
      if (game.challengerCorrect) {
        game.challengerScore += 1;
      }
      
      game.phase = 'decision';
      console.log('Both answered, moving to decision phase');
    }

    io.to(gameId).emit('game-updated', game);
  });

  // Entscheidung treffen
  socket.on('make-decision', (data) => {
    console.log('MAKE DECISION:', data);
    const { gameId, decision } = data;
    const game = games.get(gameId);
    
    if (!game) return;
    
    const player = game.players.find(p => p.id === socket.id);
    if (!player || (player.gameRole !== 'challenger' && game.challengerId !== socket.id)) {
      console.log('Non-challenger tried to make decision');
      return;
    }

    const currentQ = game.questions[game.currentQuestion];
    const moderatorCorrect = parseInt(game.moderatorAnswer) === currentQ.correct;

    game.decision = decision;
    game.lastActivity = Date.now();

    if (decision === 'trust') {
      game.moderatorScore += 1;
      game.roundResult = `${game.challengerName} vertraut ${game.moderatorName}. ${game.moderatorName} erhält 1 Punkt.`;
    } else {
      game.challengerCoins -= 1;
      game.showModeratorAnswer = true;
      
      if (moderatorCorrect) {
        game.moderatorScore += 1;
        game.roundResult = `${game.challengerName} zweifelt. ${game.moderatorName} hatte recht und erhält 1 Punkt. Münze verloren!`;
      } else {
        game.challengerCoins += 1;
        game.roundResult = `${game.challengerName} zweifelt. ${game.moderatorName} lag falsch. Münze bleibt erhalten.`;
      }
    }

    game.phase = 'result';
    console.log('Decision made:', decision, 'Result:', game.roundResult);
    io.to(gameId).emit('game-updated', game);
  });

  // Nächste Runde
  socket.on('next-round', (data) => {
    console.log('NEXT ROUND:', data);
    const { gameId } = data;
    const game = games.get(gameId);

    if (!game) return;

    game.lastActivity = Date.now();

    // Gewinnbedingungen prüfen
    if (game.challengerScore >= 5) {
      game.winner = game.challengerName;
      game.state = 'finished';
    } else if (game.moderatorScore >= 5) {
      game.winner = game.moderatorName;
      game.state = 'finished';
    } else if (game.challengerCoins <= 0) {
      game.winner = game.moderatorName;
      game.state = 'finished';
    } else {
      // Nächste Frage
      game.currentQuestion += 1;
      
      // Falls wir mehr Fragen brauchen, füge neue hinzu
      if (game.currentQuestion >= game.questions.length - 5) {
        const newQuestions = getRandomQuestions(10);
        game.questions.push(...newQuestions);
      }
      
      game.phase = 'answering';
      game.challengerAnswer = '';
      game.moderatorAnswer = '';
      game.challengerAnswered = false;
      game.moderatorAnswered = false;
      game.challengerCorrect = false;
      game.decision = '';
      game.roundResult = '';
      game.showModeratorAnswer = false;
    }

    console.log('Next round - Question:', game.currentQuestion, 'State:', game.state);
    io.to(gameId).emit('game-updated', game);
  });

  // Spieler disconnect
  socket.on('disconnect', () => {
    console.log('Spieler getrennt:', socket.id);
    
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const game = games.get(playerInfo.gameId);
      if (game) {
        const disconnectedPlayer = game.players.find(p => p.id === socket.id);
        
        if (disconnectedPlayer) {
          disconnectedPlayer.connected = false;
          disconnectedPlayer.lastSeen = Date.now();
          
          // Benachrichtige andere Spieler nur wenn das Spiel läuft
          if (game.state === 'playing') {
            socket.to(playerInfo.gameId).emit('player-disconnected', {
              playerName: disconnectedPlayer.name
            });
            
            // Pausiere das Spiel
            game.state = 'paused';
            io.to(playerInfo.gameId).emit('game-paused', game);
          }
        }
      }
      players.delete(socket.id);
    }
  });
});

// Cleanup alte Spiele (alle 5 Minuten)
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 Minuten
  
  for (const [gameId, game] of games.entries()) {
    // Lösche Spiele die älter als 30 Minuten sind und keine verbundenen Spieler haben
    const allDisconnected = game.players.every(p => !p.connected);
    
    if (allDisconnected && (now - game.lastActivity > timeout)) {
      games.delete(gameId);
      console.log('Cleaned up inactive game:', gameId);
    }
  }
}, 5 * 60 * 1000);

// Debug-Endpunkt
app.get('/debug/games', (req, res) => {
  const gamesList = Array.from(games.entries()).map(([id, game]) => ({
    id,
    players: game.players.map(p => ({ 
      name: p.name, 
      role: p.role, 
      isHost: p.isHost,
      connected: p.connected,
      gameRole: p.gameRole 
    })),
    state: game.state,
    hostId: game.hostId,
    createdAt: new Date(game.createdAt).toISOString(),
    lastActivity: new Date(game.lastActivity).toISOString()
  }));
  res.json(gamesList);
});

// Server starten
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
setInterval(() => {
    console.log('Keep alive ping:', new Date().toISOString());
  }, 14 * 60 * 1000);
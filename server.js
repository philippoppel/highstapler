const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://highstapler.onrender.com",
      "https://highstapler.vercel.app",
      "https://highstapler-nis50caat-philipps-projects-0f51423d.vercel.app",
      "https://*.vercel.app",
      /^https:\/\/.*\.vercel\.app$/
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: [
    "http://localhost:3000", 
    "http://localhost:3001",
    "https://highstapler.onrender.com",
    "https://highstapler.vercel.app",
    "https://highstapler-nis50caat-philipps-projects-0f51423d.vercel.app",
    "https://*.vercel.app",
    /^https:\/\/.*\.vercel\.app$/
  ],
  credentials: true
}));
app.use(express.json());

// FIX: Korrigierte Route
app.get('/', (req, res) => {
  res.json({
    status: 'Server läuft!',
    timestamp: new Date().toISOString(),
    games: gameManager.getStats(),
    sessions: {
      active: sessionManager.sessions.size
    }
  });
});

// ============= IMPROVED SESSION HANDLING =============

// Erweiterte Session-Verwaltung
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.reconnectTokens = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000); // 5 Minuten
  }

  createSession(socketId, gameId, playerName, role, isHost) {
    const sessionId = crypto.randomUUID();
    const reconnectToken = crypto.randomBytes(32).toString('hex');
    
    const session = {
      id: sessionId,
      socketId,
      gameId,
      playerName,
      role,
      isHost,
      reconnectToken,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      connected: true
    };

    this.sessions.set(sessionId, session);
    this.reconnectTokens.set(reconnectToken, sessionId);
    
    return { sessionId, reconnectToken };
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  findSessionByReconnectToken(token) {
    const sessionId = this.reconnectTokens.get(token);
    return sessionId ? this.sessions.get(sessionId) : null;
  }

  findSessionBySocket(socketId) {
    for (const session of this.sessions.values()) {
      if (session.socketId === socketId) {
        return session;
      }
    }
    return null;
  }

  findSessionsByGame(gameId) {
    return Array.from(this.sessions.values()).filter(s => s.gameId === gameId);
  }

  updateSession(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates, { lastActivity: Date.now() });
      return session;
    }
    return null;
  }

  disconnectSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connected = false;
      session.disconnectedAt = Date.now();
    }
    return session;
  }

  reconnectSession(sessionId, newSocketId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socketId = newSocketId;
      session.connected = true;
      session.lastActivity = Date.now();
      delete session.disconnectedAt;
    }
    return session;
  }

  deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.reconnectTokens.delete(session.reconnectToken);
    }
    return session;
  }

  cleanup() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 Minuten statt 2 Stunden
    const maxDisconnectedAge = 5 * 60 * 1000; // 5 Minuten statt 30
    
    // Lösche auch Sessions von beendeten Spielen sofort
    for (const [sessionId, session] of this.sessions.entries()) {
      const game = gameManager.getGame(session.gameId);
      if (!game || game.state === 'finished') {
        this.deleteSession(sessionId);
        continue;
      }
      
      const age = now - session.createdAt;
      const disconnectedAge = session.disconnectedAt ? now - session.disconnectedAt : 0;
  
      if (age > maxAge || disconnectedAge > maxDisconnectedAge) {
        this.deleteSession(sessionId);
        console.log('Session cleaned up:', sessionId);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    this.reconnectTokens.clear();
  }
}

// ============= IMPROVED GAME MANAGER =============

class GameManager {
  constructor() {
    this.games = new Map();
    this.gamesByPlayer = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  createGame(hostId, hostName) {
    const gameId = this.generateGameId();
    const initialCoins = this.getRandomCoins();
    
    const game = {
      id: gameId,
      hostId,
      hostName,
      players: [{
        id: hostId,
        name: hostName,
        role: 'host',
        isHost: true,
        connected: true,
        lastSeen: Date.now()
      }],
      questions: [],
      currentQuestion: 0,
      state: 'lobby', // lobby, setup, playing, paused, finished
      challengerScore: 0,
      moderatorScore: 0,
      challengerCoins: initialCoins,
      initialCoins: initialCoins,
      challengerName: '',
      moderatorName: '',
      challengerId: null,
      moderatorId: null,
      phase: 'answering', // answering, decision, result
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
      lastActivity: Date.now(),
      version: 1 // Für Synchronisation
    };

    this.games.set(gameId, game);
    this.gamesByPlayer.set(hostId, gameId);
    
    return game;
  }

  getGame(gameId) {
    return this.games.get(gameId?.toUpperCase());
  }

  getGameByPlayer(playerId) {
    const gameId = this.gamesByPlayer.get(playerId);
    return gameId ? this.games.get(gameId) : null;
  }

  updateGame(gameId, updates) {
    const game = this.games.get(gameId);
    if (game) {
      Object.assign(game, updates, { 
        lastActivity: Date.now(),
        version: game.version + 1
      });
      return game;
    }
    return null;
  }

  addPlayerToGame(gameId, playerId, playerName) {
    const game = this.games.get(gameId);
    if (!game || game.players.length >= 2) {
      return null;
    }

    const player = {
      id: playerId,
      name: playerName,
      role: 'player2',
      isHost: false,
      connected: true,
      lastSeen: Date.now()
    };

    game.players.push(player);
    this.gamesByPlayer.set(playerId, gameId);
    
    // Rollen zuweisen wenn 2 Spieler
    if (game.players.length === 2) {
      this.assignRoles(game);
    }

    game.lastActivity = Date.now();
    game.version++;
    
    return game;
  }

  assignRoles(game) {
    if (game.players.length !== 2) return;

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
  }

  removePlayerFromGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) return null;

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;

    game.players.splice(playerIndex, 1);
    this.gamesByPlayer.delete(playerId);
    
    // Wenn Host verlässt, Spiel beenden
    if (game.hostId === playerId) {
      this.deleteGame(gameId);
      return null;
    }

    game.lastActivity = Date.now();
    game.version++;
    
    return game;
  }

  deleteGame(gameId) {
    const game = this.games.get(gameId);
    if (game) {
      // Alle Spieler aus gamesByPlayer entfernen
      game.players.forEach(player => {
        this.gamesByPlayer.delete(player.id);
      });
      
      this.games.delete(gameId);
      return true;
    }
    return false;
  }

  generateGameId() {
    let gameId;
    do {
      gameId = Math.random().toString(36).substr(2, 6).toUpperCase();
    } while (this.games.has(gameId));
    return gameId;
  }

  getRandomCoins() {
    return Math.floor(Math.random() * 3) + 1; // 1-3 Münzen
  }

  cleanup() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 Minuten
    
    for (const [gameId, game] of this.games.entries()) {
      const allDisconnected = game.players.every(p => !p.connected);
      
      if (allDisconnected && (now - game.lastActivity > timeout)) {
        this.deleteGame(gameId);
        console.log('Cleaned up inactive game:', gameId);
      }
    }
  }

  getStats() {
    return {
      totalGames: this.games.size,
      activeGames: Array.from(this.games.values()).filter(g => g.state === 'playing').length,
      lobbyGames: Array.from(this.games.values()).filter(g => g.state === 'lobby').length,
      finishedGames: Array.from(this.games.values()).filter(g => g.state === 'finished').length
    };
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.games.clear();
    this.gamesByPlayer.clear();
  }
}

// ============= QUESTION SERVICE (IMPROVED) =============

class QuestionService {
  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.deeplApiKey = process.env.DEEPL_API_KEY;
    
    // Caches
    this.questionCache = [];
    this.translationCache = new Map();
    this.usedQuestions = new Set();
    this.sessionToken = null;
    
    // Rate limiting
    this.groqRequestCount = 0;
    this.groqResetTime = Date.now() + 60000; // 1 Minute
    this.deeplRequestCount = 0;
    this.deeplResetTime = Date.now() + 60000;
    
    // Statistiken
    this.stats = {
      totalGenerated: 0,
      fromGroq: 0,
      fromTriviaAPI: 0,
      fromLocal: 0,
      translations: 0,
      cacheHits: 0,
      errors: 0
    };

    this.initTriviaSession();
  }

  async initTriviaSession() {
    try {
      const response = await axios.get('https://opentdb.com/api_token.php?command=request');
      this.sessionToken = response.data.token;
      console.log('Trivia API Session initialisiert');
    } catch (error) {
      console.error('Trivia Session Fehler:', error);
    }
  }

  async getQuestions(count = 10, gameId = null) {
    console.log(`Generiere ${count} neue Fragen für Spiel ${gameId}`);
    
    let questions = [];
    
    // Prüfe Cache zuerst
    if (this.questionCache.length > 0) {
      const fromCache = this.questionCache.splice(0, Math.min(count, this.questionCache.length));
      questions.push(...fromCache);
      this.stats.cacheHits += fromCache.length;
      console.log(`${fromCache.length} Fragen aus Cache verwendet`);
    }
    
    const remaining = count - questions.length;
    if (remaining <= 0) {
      return this.deduplicateQuestions(questions, gameId);
    }
    
    // Versuche Groq AI (mit Rate Limiting)
    if (this.groqApiKey && this.canMakeGroqRequest()) {
      try {
        const groqQuestions = await this.generateWithGroq(Math.ceil(remaining * 0.7));
        questions.push(...groqQuestions);
        console.log(`${groqQuestions.length} Fragen von Groq generiert`);
      } catch (error) {
        console.error('Groq Fehler:', error);
        this.stats.errors++;
      }
    }
    
    // Fülle mit Trivia API auf
    const stillNeeded = count - questions.length;
    if (stillNeeded > 0) {
      try {
        const triviaQuestions = await this.fetchFromTriviaAPI(stillNeeded);
        questions.push(...triviaQuestions);
        console.log(`${triviaQuestions.length} Fragen von Trivia API geholt`);
      } catch (error) {
        console.error('Trivia API Fehler:', error);
        this.stats.errors++;
      }
    }
    
    // Fallback auf lokale Fragen
    const finallyNeeded = count - questions.length;
    if (finallyNeeded > 0) {
      const localQuestions = this.getLocalQuestions(finallyNeeded);
      questions.push(...localQuestions);
      console.log(`${localQuestions.length} lokale Fragen verwendet`);
    }
    
    // Fülle Cache mit zusätzlichen Fragen auf
    if (this.questionCache.length < 20) {
      this.prefillCache();
    }
    
    return this.deduplicateQuestions(questions, gameId).slice(0, count);
  }

  canMakeGroqRequest() {
    const now = Date.now();
    if (now > this.groqResetTime) {
      this.groqRequestCount = 0;
      this.groqResetTime = now + 60000;
    }
    return this.groqRequestCount < 30; // 30 Anfragen pro Minute
  }

  canMakeDeeplRequest() {
    const now = Date.now();
    if (now > this.deeplResetTime) {
      this.deeplRequestCount = 0;
      this.deeplResetTime = now + 60000;
    }
    return this.deeplRequestCount < 10; // 10 Anfragen pro Minute
  }

  async prefillCache() {
    // Asynchron Cache auffüllen
    setTimeout(async () => {
      try {
        const questions = await this.generateWithGroq(10);
        this.questionCache.push(...questions);
        console.log(`${questions.length} Fragen in Cache vorgefüllt`);
      } catch (error) {
        console.error('Cache Prefill Fehler:', error);
      }
    }, 1000);
  }

  async generateWithGroq(count) {
    if (!this.groqApiKey || !this.canMakeGroqRequest()) return [];
    
    this.groqRequestCount++;
    
    try {
      const categories = ['Geografie', 'Geschichte', 'Wissenschaft', 'Kultur', 'Sport', 'Allgemeinwissen'];
      const selectedCategory = categories[Math.floor(Math.random() * categories.length)];
      
      const prompt = `Generiere ${count} hochwertige deutsche Multiple-Choice Quizfragen für die Kategorie "${selectedCategory}".

WICHTIGE ANFORDERUNGEN:
1. Die Fragen müssen faktisch 100% korrekt sein (Stand 2024)
2. Genau EINE richtige Antwort pro Frage
3. Drei plausible aber definitiv falsche Alternativen
4. Fragen sollen interessant und lehrreich sein
5. Verschiedene Schwierigkeitsgrade
6. Vermeide zu schwierige oder obskure Fragen

Antworte NUR mit validem JSON in diesem Format:
{
  "questions": [
    {
      "question": "Die Frage hier",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "category": "${selectedCategory}",
      "difficulty": "mittel"
    }
  ]
}`;

      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content: 'Du bist ein Experte für Quizfragen. Antworte immer nur mit validem JSON ohne zusätzlichen Text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 2000
      }, {
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const content = response.data.choices[0].message.content;
      let parsed;
      
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        // Versuche JSON aus Antwort zu extrahieren
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw parseError;
        }
      }
      
      const questions = parsed.questions.map(q => ({
        ...q,
        source: 'groq',
        correct: parseInt(q.correct),
        id: crypto.randomUUID()
      }));
      
      this.stats.fromGroq += questions.length;
      this.stats.totalGenerated += questions.length;
      return questions;
      
    } catch (error) {
      console.error('Groq Generierung Fehler:', error.response?.data || error.message);
      this.stats.errors++;
      return [];
    }
  }

  async fetchFromTriviaAPI(count) {
    try {
      const params = {
        amount: Math.min(count, 10), // Max 10 pro Anfrage
        type: 'multiple',
        encode: 'base64'
      };
      
      if (this.sessionToken) {
        params.token = this.sessionToken;
      }
      
      const response = await axios.get('https://opentdb.com/api.php', { 
        params,
        timeout: 15000
      });
      
      if (response.data.response_code === 4) {
        // Token exhausted, reset
        await this.initTriviaSession();
        return this.fetchFromTriviaAPI(count);
      }
      
      if (response.data.response_code !== 0) {
        throw new Error('Trivia API Error: ' + response.data.response_code);
      }
      
      const questions = [];
      
      for (const q of response.data.results) {
        try {
          // Dekodiere Base64
          const question = Buffer.from(q.question, 'base64').toString('utf-8');
          const correctAnswer = Buffer.from(q.correct_answer, 'base64').toString('utf-8');
          const incorrectAnswers = q.incorrect_answers.map(a => 
            Buffer.from(a, 'base64').toString('utf-8')
          );
          
          // Übersetze ins Deutsche
          const translatedQ = await this.translateText(question);
          const translatedCorrect = await this.translateText(correctAnswer);
          const translatedIncorrect = await Promise.all(
            incorrectAnswers.map(a => this.translateText(a))
          );
          
          // Mische Antworten
          const allOptions = [...translatedIncorrect, translatedCorrect];
          const shuffled = this.shuffle(allOptions);
          const correctIndex = shuffled.indexOf(translatedCorrect);
          
          questions.push({
            question: translatedQ,
            options: shuffled,
            correct: correctIndex,
            category: this.mapCategory(q.category),
            difficulty: q.difficulty,
            source: 'triviaAPI',
            id: crypto.randomUUID()
          });
        } catch (error) {
          console.error('Fehler bei Frage-Verarbeitung:', error);
          continue;
        }
      }
      
      this.stats.fromTriviaAPI += questions.length;
      this.stats.totalGenerated += questions.length;
      return questions;
      
    } catch (error) {
      console.error('Trivia API Fehler:', error);
      this.stats.errors++;
      return [];
    }
  }

  async translateText(text) {
    // Cache check
    if (this.translationCache.has(text)) {
      return this.translationCache.get(text);
    }
    
    // Einfache Übersetzungen
    const simpleTranslations = {
      'True': 'Richtig',
      'False': 'Falsch',
      'Yes': 'Ja',
      'No': 'Nein',
      'North': 'Nord',
      'South': 'Süd',
      'East': 'Ost',
      'West': 'West',
      'All of the above': 'Alle genannten',
      'None of the above': 'Keine der genannten'
    };
    
    if (simpleTranslations[text]) {
      this.translationCache.set(text, simpleTranslations[text]);
      return simpleTranslations[text];
    }
    
    // DeepL Übersetzung (mit Rate Limiting)
    if (this.deeplApiKey && this.canMakeDeeplRequest()) {
      try {
        this.deeplRequestCount++;
        
        const response = await axios.post('https://api-free.deepl.com/v2/translate', {
          text: [text],
          target_lang: 'DE'
        }, {
          headers: {
            'Authorization': `DeepL-Auth-Key ${this.deeplApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        const translated = response.data.translations[0].text;
        this.translationCache.set(text, translated);
        this.stats.translations++;
        return translated;
        
      } catch (error) {
        console.error('DeepL Übersetzungsfehler:', error);
      }
    }
    
    // Fallback: Original zurückgeben
    this.translationCache.set(text, text);
    return text;
  }

  getLocalQuestions(count) {
    const unused = questionDatabase.filter(q => {
      const hash = this.hashQuestion(q.question);
      return !this.usedQuestions.has(hash);
    });
    
    const shuffled = this.shuffle(unused);
    const selected = shuffled.slice(0, count);
    
    selected.forEach(q => {
      this.usedQuestions.add(this.hashQuestion(q.question));
    });
    
    this.stats.fromLocal += selected.length;
    this.stats.totalGenerated += selected.length;
    
    return selected.map(q => ({
      ...q,
      source: 'local',
      id: crypto.randomUUID()
    }));
  }

  deduplicateQuestions(questions, gameId) {
    const unique = [];
    const seen = new Set();
    
    for (const q of questions) {
      const hash = this.hashQuestion(q.question);
      
      if (!seen.has(hash) && !this.usedQuestions.has(hash)) {
        unique.push(q);
        seen.add(hash);
        this.usedQuestions.add(hash);
      }
    }
    
    return unique;
  }

  mapCategory(apiCategory) {
    const mapping = {
      'Geography': 'Geografie',
      'History': 'Geschichte',
      'Science': 'Wissenschaft',
      'Science & Nature': 'Wissenschaft',
      'Sports': 'Sport',
      'Entertainment': 'Kultur',
      'Art': 'Kultur',
      'General Knowledge': 'Allgemeinwissen',
      'Mythology': 'Geschichte',
      'Politics': 'Geschichte',
      'Celebrities': 'Kultur',
      'Animals': 'Wissenschaft'
    };
    
    return mapping[apiCategory] || 'Allgemeinwissen';
  }

  hashQuestion(question) {
    return crypto.createHash('md5').update(question.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')).digest('hex');
  }

  shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  getStats() {
    return {
      ...this.stats,
      cacheSize: this.questionCache.length,
      translationCacheSize: this.translationCache.size,
      usedQuestionsCount: this.usedQuestions.size,
      groqRateLimit: {
        requests: this.groqRequestCount,
        resetTime: new Date(this.groqResetTime).toISOString()
      },
      deeplRateLimit: {
        requests: this.deeplRequestCount,
        resetTime: new Date(this.deeplResetTime).toISOString()
      }
    };
  }

  clearCache() {
    this.questionCache = [];
    this.usedQuestions.clear();
    this.translationCache.clear();
    console.log('Question cache geleert');
  }
}

// Lokale Fragendatenbank als Fallback
const questionDatabase = [
  // Geografie
  { question: "Welches ist das kleinste Land der Welt?", options: ["Monaco", "Vatikanstadt", "San Marino", "Liechtenstein"], correct: 1, category: "Geografie" },
  { question: "Wie heißt die Hauptstadt von Island?", options: ["Oslo", "Reykjavik", "Helsinki", "Stockholm"], correct: 1, category: "Geografie" },
  { question: "Welcher ist der längste Fluss Europas?", options: ["Donau", "Rhein", "Wolga", "Seine"], correct: 2, category: "Geografie" },
  { question: "Wie viele Zeitzonen gibt es in Russland?", options: ["7", "9", "11", "13"], correct: 2, category: "Geografie" },
  { question: "Welches Land hat die meisten Inseln?", options: ["Indonesien", "Schweden", "Kanada", "Japan"], correct: 1, category: "Geografie" },
  { question: "Welcher Berg ist der höchste in Afrika?", options: ["Mount Kenya", "Kilimandscharo", "Atlas", "Drakensberg"], correct: 1, category: "Geografie" },
  { question: "Welches Land grenzt an die meisten anderen Länder?", options: ["Russland", "China", "Brasilien", "Deutschland"], correct: 1, category: "Geografie" },
  { question: "Wie heißt die Wüste im Süden Israels?", options: ["Sahara", "Gobi", "Negev", "Atacama"], correct: 2, category: "Geografie" },
  
  // Geschichte
  { question: "In welchem Jahr wurde die UNO gegründet?", options: ["1943", "1945", "1947", "1949"], correct: 1, category: "Geschichte" },
  { question: "Wer war der erste Mensch im Weltraum?", options: ["Neil Armstrong", "Buzz Aldrin", "Juri Gagarin", "Alan Shepard"], correct: 2, category: "Geschichte" },
  { question: "Wie lange dauerte der Hundertjährige Krieg?", options: ["100 Jahre", "116 Jahre", "99 Jahre", "124 Jahre"], correct: 1, category: "Geschichte" },
  { question: "Welches war das erste Land mit Frauenwahlrecht?", options: ["USA", "Neuseeland", "Schweiz", "England"], correct: 1, category: "Geschichte" },
  { question: "In welchem Jahr endete der Erste Weltkrieg?", options: ["1916", "1917", "1918", "1919"], correct: 2, category: "Geschichte" },
  { question: "Wer erfand das Telefon?", options: ["Thomas Edison", "Alexander Graham Bell", "Nikola Tesla", "Guglielmo Marconi"], correct: 1, category: "Geschichte" },
  { question: "In welchem Jahr fiel die Berliner Mauer?", options: ["1987", "1988", "1989", "1990"], correct: 2, category: "Geschichte" },
  { question: "Welches Schiff sank 1912 auf seiner Jungfernfahrt?", options: ["Lusitania", "Titanic", "Britannic", "Queen Mary"], correct: 1, category: "Geschichte" },
  
  // Wissenschaft
  { question: "Wie viele Knochen hat ein erwachsener Mensch?", options: ["186", "206", "226", "246"], correct: 1, category: "Wissenschaft" },
  { question: "Was ist die häufigste Blutgruppe?", options: ["A+", "B+", "O+", "AB+"], correct: 2, category: "Wissenschaft" },
  { question: "Welches ist das leichteste Element?", options: ["Helium", "Wasserstoff", "Lithium", "Beryllium"], correct: 1, category: "Wissenschaft" },
  { question: "Wie viel Prozent der Erde sind mit Wasser bedeckt?", options: ["61%", "71%", "81%", "91%"], correct: 1, category: "Wissenschaft" },
  { question: "Was ist die Schallgeschwindigkeit?", options: ["343 m/s", "443 m/s", "543 m/s", "643 m/s"], correct: 0, category: "Wissenschaft" },
  { question: "Welches Organ produziert Insulin?", options: ["Leber", "Niere", "Bauchspeicheldrüse", "Milz"], correct: 2, category: "Wissenschaft" },
  { question: "Wie viele Planeten hat unser Sonnensystem?", options: ["7", "8", "9", "10"], correct: 1, category: "Wissenschaft" },
  { question: "Was ist die chemische Formel für Wasser?", options: ["H2O", "CO2", "O2", "H2O2"], correct: 0, category: "Wissenschaft" },
  
  // Kultur & Unterhaltung
  { question: "Wer komponierte 'Die Zauberflöte'?", options: ["Beethoven", "Bach", "Mozart", "Händel"], correct: 2, category: "Kultur" },
  { question: "Wie viele Harry Potter Filme gibt es?", options: ["6", "7", "8", "9"], correct: 2, category: "Kultur" },
  { question: "In welchem Jahr wurde Netflix gegründet?", options: ["1995", "1997", "1999", "2001"], correct: 1, category: "Kultur" },
  { question: "Wer malte 'Die Sternennacht'?", options: ["Monet", "Van Gogh", "Picasso", "Dalí"], correct: 1, category: "Kultur" },
  { question: "Wie viele Saiten hat eine klassische Gitarre?", options: ["4", "5", "6", "7"], correct: 2, category: "Kultur" },
  { question: "Wer schrieb 'Romeo und Julia'?", options: ["Goethe", "Shakespeare", "Schiller", "Dante"], correct: 1, category: "Kultur" },
  { question: "Wie viele Oscars gewann 'Titanic'?", options: ["9", "10", "11", "12"], correct: 2, category: "Kultur" },
  { question: "Welche Band veröffentlichte 'Bohemian Rhapsody'?", options: ["The Beatles", "Queen", "Led Zeppelin", "Pink Floyd"], correct: 1, category: "Kultur" },
  
  // Sport
  { question: "Wie viele Spieler sind in einer Volleyball-Mannschaft?", options: ["4", "5", "6", "7"], correct: 2, category: "Sport" },
  { question: "In welchem Land wurden die Olympischen Spiele erfunden?", options: ["Italien", "Griechenland", "Frankreich", "England"], correct: 1, category: "Sport" },
  { question: "Wie lang ist ein Marathon?", options: ["40,195 km", "41,195 km", "42,195 km", "43,195 km"], correct: 2, category: "Sport" },
  { question: "Welche Sportart heißt auch 'Königin der Sportarten'?", options: ["Fußball", "Tennis", "Leichtathletik", "Schwimmen"], correct: 2, category: "Sport" },
  { question: "Wie viele Punkte ist ein Touchdown wert?", options: ["5", "6", "7", "8"], correct: 1, category: "Sport" },
  { question: "Wie oft findet die Fußball-WM statt?", options: ["Alle 2 Jahre", "Alle 3 Jahre", "Alle 4 Jahre", "Alle 5 Jahre"], correct: 2, category: "Sport" },
  { question: "Wie viele Ringe hat das Olympische Symbol?", options: ["4", "5", "6", "7"], correct: 1, category: "Sport" },
  { question: "Welches Land gewann die meisten Fußball-Weltmeisterschaften?", options: ["Deutschland", "Argentinien", "Italien", "Brasilien"], correct: 3, category: "Sport" },
  
  // Allgemeinwissen
  { question: "Wie viele Zähne hat ein erwachsener Mensch normalerweise?", options: ["28", "30", "32", "34"], correct: 2, category: "Allgemeinwissen" },
  { question: "Was ist die meistgesprochene Sprache der Welt?", options: ["Englisch", "Mandarin", "Spanisch", "Hindi"], correct: 1, category: "Allgemeinwissen" },
  { question: "Wie viele Herzen hat ein Oktopus?", options: ["1", "2", "3", "4"], correct: 2, category: "Allgemeinwissen" },
  { question: "Welches Tier schläft am wenigsten?", options: ["Giraffe", "Elefant", "Delfin", "Pferd"], correct: 0, category: "Allgemeinwissen" },
  { question: "Was bedeutet 'www'?", options: ["World Wide Web", "World Web Wide", "Web World Wide", "Wide World Web"], correct: 0, category: "Allgemeinwissen" },
  { question: "Wie viele Buchstaben hat das deutsche Alphabet?", options: ["24", "26", "28", "30"], correct: 2, category: "Allgemeinwissen" },
  { question: "Welches ist das häufigste Element im Universum?", options: ["Sauerstoff", "Kohlenstoff", "Wasserstoff", "Helium"], correct: 2, category: "Allgemeinwissen" },
  { question: "Wie viele Minuten hat eine Stunde?", options: ["50", "60", "70", "80"], correct: 1, category: "Allgemeinwissen" }
];

// Instanzen
const sessionManager = new SessionManager();
const gameManager = new GameManager();
const questionService = new QuestionService();

// Hilfsfunktionen
const getRandomQuestions = async (count = 10, gameId = null) => {
  try {
    return await questionService.getQuestions(count, gameId);
  } catch (error) {
    console.error('Fehler bei Fragengenerierung:', error);
    // Fallback auf lokale Fragen
    const shuffled = [...questionDatabase].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
};

// API Endpoints
app.get('/api/stats', (req, res) => {
  res.json({
    games: gameManager.getStats(),
    questions: questionService.getStats(),
    sessions: {
      active: sessionManager.sessions.size,
      reconnectTokens: sessionManager.reconnectTokens.size
    }
  });
});

app.get('/api/question-stats', (req, res) => {
  res.json(questionService.getStats());
});

app.post('/api/clear-question-cache', (req, res) => {
  questionService.clearCache();
  res.json({ success: true, message: 'Question cache cleared' });
});

// Debug-Endpunkt
app.get('/debug/games', (req, res) => {
  const gamesList = Array.from(gameManager.games.entries()).map(([id, game]) => ({
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
    lastActivity: new Date(game.lastActivity).toISOString(),
    version: game.version
  }));
  res.json(gamesList);
});

app.get('/debug/sessions', (req, res) => {
  const sessionsList = Array.from(sessionManager.sessions.values()).map(session => ({
    id: session.id,
    gameId: session.gameId,
    playerName: session.playerName,
    role: session.role,
    isHost: session.isHost,
    connected: session.connected,
    createdAt: new Date(session.createdAt).toISOString(),
    lastActivity: new Date(session.lastActivity).toISOString()
  }));
  res.json(sessionsList);
});

// ============= SOCKET.IO EVENTS (IMPROVED) =============

// Erweiterte Fehlerbehandlung
const handleSocketError = (socket, error, context) => {
  console.error(`Socket error in ${context}:`, error);
  socket.emit('error', { 
    message: 'Ein Fehler ist aufgetreten', 
    context,
    timestamp: new Date().toISOString()
  });
};

// Authentifizierung Middleware
const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth.token;
  const reconnectToken = socket.handshake.auth.reconnectToken;
  
  if (reconnectToken) {
    const session = sessionManager.findSessionByReconnectToken(reconnectToken);
    if (session) {
      socket.session = session;
      sessionManager.reconnectSession(session.id, socket.id);
      console.log('Socket reconnected with session:', session.id);
    }
  }
  
  next();
};

io.use(authenticateSocket);

io.on('connection', (socket) => {
  console.log('Neuer Spieler verbunden:', socket.id);
  
  // Heartbeat für Verbindungsüberwachung
  const heartbeatInterval = setInterval(() => {
    socket.emit('ping');
  }, 30000);
  
  socket.on('pong', () => {
    const session = sessionManager.findSessionBySocket(socket.id);
    if (session) {
      sessionManager.updateSession(session.id, { lastActivity: Date.now() });
    }
  });

  // Spiel erstellen
  socket.on('create-game', async (data) => {
    try {
      console.log('CREATE GAME:', data);
      const game = gameManager.createGame(socket.id, data.playerName);
      
      // Session erstellen
      const { sessionId, reconnectToken } = sessionManager.createSession(
        socket.id, 
        game.id, 
        data.playerName, 
        'host', 
        true
      );
      
      // Fragen laden
      game.questions = await getRandomQuestions(30, game.id);
      
      socket.join(game.id);
      socket.emit('game-created', { 
        gameId: game.id, 
        game,
        sessionId,
        reconnectToken
      });
      
      console.log('Game created:', game.id, 'by', data.playerName);
    } catch (error) {
      handleSocketError(socket, error, 'create-game');
    }
  });

  // Spiel beitreten
  socket.on('join-game', async (data) => {
    try {
      console.log('JOIN GAME:', data);
      const { gameId, playerName } = data;
      const game = gameManager.getGame(gameId);

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
        
        // Session aktualisieren
        const sessions = sessionManager.findSessionsByGame(gameId);
        const session = sessions.find(s => s.playerName === playerName);
        if (session) {
          sessionManager.reconnectSession(session.id, socket.id);
        }
        
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
        
        gameManager.updateGame(gameId, {});
        
        socket.emit('joined-game', { 
          gameId, 
          role: existingPlayer.role,
          isHost: existingPlayer.isHost,
          gameRole: existingPlayer.gameRole,
          reconnectToken: session?.reconnectToken
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
      const updatedGame = gameManager.addPlayerToGame(gameId, socket.id, playerName);
      if (!updatedGame) {
        socket.emit('error', { message: 'Konnte Spiel nicht beitreten!' });
        return;
      }

      // Session erstellen
      const { sessionId, reconnectToken } = sessionManager.createSession(
        socket.id, 
        gameId, 
        playerName, 
        'player2', 
        false
      );

      socket.join(gameId);

      // Update an alle Spieler senden
      io.to(gameId).emit('game-updated', updatedGame);
      
      // Dem beitretenden Spieler seine Rolle mitteilen
      const joinedPlayer = updatedGame.players.find(p => p.id === socket.id);
      socket.emit('joined-game', { 
        gameId, 
        role: joinedPlayer.role,
        isHost: joinedPlayer.isHost,
        gameRole: joinedPlayer.gameRole,
        sessionId,
        reconnectToken
      });

      console.log('Player joined:', playerName, 'to game:', gameId);
    } catch (error) {
      handleSocketError(socket, error, 'join-game');
    }
  });

  // Spiel starten
  socket.on('start-game', async (data) => {
    try {
      console.log('START GAME:', data);
      const { gameId } = data;
      const game = gameManager.getGame(gameId);

      if (!game) {
        console.log('Game not found for start:', gameId);
        return;
      }

      const session = sessionManager.findSessionBySocket(socket.id);
      if (!session || !session.isHost) {
        console.log('Non-host tried to start game:', socket.id);
        return;
      }

      // Zusätzliche Fragen laden falls nötig
      if (game.questions.length < 10) {
        const newQuestions = await getRandomQuestions(20, gameId);
        game.questions.push(...newQuestions);
      }

      gameManager.updateGame(gameId, {
        state: 'playing',
        phase: 'answering',
        currentQuestion: 0
      });

      console.log('Game started:', gameId);
      io.to(gameId).emit('game-started', game);
    } catch (error) {
      handleSocketError(socket, error, 'start-game');
    }
  });

  // Antwort abgeben
  socket.on('submit-answer', (data) => {
    try {
      console.log('SUBMIT ANSWER:', data);
      const { gameId, answer } = data;
      const game = gameManager.getGame(gameId);
      
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

      const updates = {};

      if (player.gameRole === 'challenger' || (player.isHost && game.challengerId === socket.id)) {
        updates.challengerAnswer = answer;
        updates.challengerAnswered = true;
        console.log('Challenger answered');
      } else if (player.gameRole === 'moderator' || (player.isHost && game.moderatorId === socket.id)) {
        updates.moderatorAnswer = answer;
        updates.moderatorAnswered = true;
        console.log('Moderator answered');
      }

      gameManager.updateGame(gameId, updates);

      // Prüfen ob beide geantwortet haben
      if (game.challengerAnswered && game.moderatorAnswered) {
        const currentQ = game.questions[game.currentQuestion];
        const challengerCorrect = parseInt(game.challengerAnswer) === currentQ.correct;
        
        gameManager.updateGame(gameId, {
          challengerCorrect,
          challengerScore: challengerCorrect ? game.challengerScore + 1 : game.challengerScore,
          phase: 'decision'
        });
        
        console.log('Both answered, moving to decision phase');
      }

      io.to(gameId).emit('game-updated', game);
    } catch (error) {
      handleSocketError(socket, error, 'submit-answer');
    }
  });

  // Entscheidung treffen
  socket.on('make-decision', (data) => {
    try {
      console.log('MAKE DECISION:', data);
      const { gameId, decision } = data;
      const game = gameManager.getGame(gameId);
      
      if (!game) return;
      
      const player = game.players.find(p => p.id === socket.id);
      if (!player || (player.gameRole !== 'challenger' && game.challengerId !== socket.id)) {
        console.log('Non-challenger tried to make decision');
        return;
      }

      const currentQ = game.questions[game.currentQuestion];
      const moderatorCorrect = parseInt(game.moderatorAnswer) === currentQ.correct;

      let roundResult;
      let updates = { decision, phase: 'result' };

      if (decision === 'trust') {
        updates.moderatorScore = game.moderatorScore + 1;
        roundResult = `${game.challengerName} vertraut ${game.moderatorName}. ${game.moderatorName} erhält 1 Punkt.`;
      } else {
        updates.challengerCoins = game.challengerCoins - 1;
        updates.showModeratorAnswer = true;
        
        if (moderatorCorrect) {
          updates.moderatorScore = game.moderatorScore + 1;
          roundResult = `${game.challengerName} zweifelt. ${game.moderatorName} hatte recht und erhält 1 Punkt. Münze verloren!`;
        } else {
          updates.challengerCoins = game.challengerCoins; // Korrektur: Münze bleibt
          roundResult = `${game.challengerName} zweifelt. ${game.moderatorName} lag falsch. Münze bleibt erhalten.`;
        }
      }

      updates.roundResult = roundResult;
      gameManager.updateGame(gameId, updates);

      console.log('Decision made:', decision, 'Result:', roundResult);
      io.to(gameId).emit('game-updated', game);
    } catch (error) {
      handleSocketError(socket, error, 'make-decision');
    }
  });

  // Nächste Runde
  socket.on('next-round', async (data) => {
    try {
      console.log('NEXT ROUND:', data);
      const { gameId } = data;
      const game = gameManager.getGame(gameId);

      if (!game) return;

      // Gewinnbedingungen prüfen
      let updates = {};
      
      if (game.challengerScore >= 5) {
        updates.winner = game.challengerName;
        updates.state = 'finished';
      } else if (game.moderatorScore >= 5) {
        updates.winner = game.moderatorName;
        updates.state = 'finished';
      } else if (game.challengerCoins <= 0) {
        updates.winner = game.moderatorName;
        updates.state = 'finished';
      }
      
      // Wenn Spiel beendet, lösche alle Sessions
      if (updates.state === 'finished') {
        // Lösche alle Sessions für dieses Spiel
        const sessions = sessionManager.findSessionsByGame(gameId);
        sessions.forEach(session => {
          sessionManager.deleteSession(session.id);
        });
        
        // Optional: Lösche das Spiel nach kurzer Zeit
        setTimeout(() => {
          gameManager.deleteGame(gameId);
        }, 5000);
      } else {
        // Nächste Frage
        updates.currentQuestion = game.currentQuestion + 1;
        
        // Falls wir mehr Fragen brauchen, füge neue hinzu
        if (game.currentQuestion >= game.questions.length - 5) {
          const newQuestions = await getRandomQuestions(10, gameId);
          game.questions.push(...newQuestions);
          console.log(`${newQuestions.length} neue Fragen zum Spiel ${gameId} hinzugefügt`);
        }
        
        updates.phase = 'answering';
        updates.challengerAnswer = '';
        updates.moderatorAnswer = '';
        updates.challengerAnswered = false;
        updates.moderatorAnswered = false;
        updates.challengerCorrect = false;
        updates.decision = '';
        updates.roundResult = '';
        updates.showModeratorAnswer = false;
      }

      gameManager.updateGame(gameId, updates);

      console.log('Next round - Question:', game.currentQuestion, 'State:', game.state);
      io.to(gameId).emit('game-updated', game);
    } catch (error) {
      handleSocketError(socket, error, 'next-round');
    }
  });

  // Spieler disconnect
  socket.on('disconnect', () => {
    console.log('Spieler getrennt:', socket.id);
    clearInterval(heartbeatInterval);
    
    try {
      const session = sessionManager.findSessionBySocket(socket.id);
      if (session) {
        sessionManager.disconnectSession(session.id);
        
        const game = gameManager.getGame(session.gameId);
        if (game) {
          const disconnectedPlayer = game.players.find(p => p.id === socket.id);
          
          if (disconnectedPlayer) {
            disconnectedPlayer.connected = false;
            disconnectedPlayer.lastSeen = Date.now();
            
            gameManager.updateGame(session.gameId, {});
            
            // Benachrichtige andere Spieler nur wenn das Spiel läuft
            if (game.state === 'playing') {
              socket.to(session.gameId).emit('player-disconnected', {
                playerName: disconnectedPlayer.name
              });
              
              // Pausiere das Spiel
              gameManager.updateGame(session.gameId, { state: 'paused' });
              io.to(session.gameId).emit('game-paused', game);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  // Reconnect handling
  socket.on('reconnect-attempt', (data) => {
    try {
      const { reconnectToken } = data;
      const session = sessionManager.findSessionByReconnectToken(reconnectToken);
      
      if (session) {
        sessionManager.reconnectSession(session.id, socket.id);
        const game = gameManager.getGame(session.gameId);
        
        if (game) {
          const player = game.players.find(p => p.name === session.playerName);
          if (player) {
            player.id = socket.id;
            player.connected = true;
            player.lastSeen = Date.now();
            
            socket.join(session.gameId);
            
            socket.emit('reconnect-success', {
              gameId: session.gameId,
              role: session.role,
              isHost: session.isHost,
              gameRole: player.gameRole
            });
            
            // Resume game if it was paused
            if (game.state === 'paused') {
              gameManager.updateGame(session.gameId, { state: 'playing' });
              io.to(session.gameId).emit('game-resumed', game);
            }
            
            io.to(session.gameId).emit('game-updated', game);
          }
        }
      } else {
        socket.emit('reconnect-failed', { message: 'Session nicht gefunden' });
      }
    } catch (error) {
      handleSocketError(socket, error, 'reconnect-attempt');
    }
  });
});

// Cleanup alte Spiele und Sessions
setInterval(() => {
  gameManager.cleanup();
  sessionManager.cleanup();
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  sessionManager.destroy();
  gameManager.destroy();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  sessionManager.destroy();
  gameManager.destroy();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Server starten
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`Groq API: ${questionService.groqApiKey ? 'Aktiviert' : 'Nicht konfiguriert'}`);
  console.log(`DeepL API: ${questionService.deeplApiKey ? 'Aktiviert' : 'Nicht konfiguriert'}`);
});

// Keep-Alive für Render
setInterval(() => {
  console.log('Keep alive ping:', new Date().toISOString());
}, 14 * 60 * 1000);
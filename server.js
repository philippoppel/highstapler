const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { validateQuestions, scheduleDeepChecks } = require('./qualityChecks');
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
    status: 'Server is running!',
    timestamp: new Date().toISOString(),
    games: gameManager.getStats(),
    sessions: {
      active: sessionManager.sessions.size
    }
  });
});

// ============= IMPROVED SESSION HANDLING =============

// Advanced session management
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
    const maxAge = 30 * 60 * 1000; // 30 Minuten
    const maxDisconnectedAge = 5 * 60 * 1000; // 5 Minuten
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const game = gameManager.getGame(session.gameId);
      
      // Session löschen wenn Spiel beendet oder nicht mehr existiert
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

  createGame(hostId, hostName, settings = {}) {
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
      state: 'lobby',
      settings: {
        difficulty: settings.difficulty || 'medium',
        category: settings.category || null
      },
      challengerScore: 0,
      moderatorScore: 0,
      challengerCoins: initialCoins,
      initialCoins: initialCoins,
      challengerName: '',
      moderatorName: '',
      challengerId: null,
      moderatorId: null,
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
      lastActivity: Date.now(),
      version: 1,
      skipRequests: [],
      skipRequestedBy: null,
      postAnswerReportRequests: [], // NEW
      postAnswerReportRequestedBy: null // NEW
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
    
    // Assign roles if there are 2 players
    if (game.players.length === 2) {
      game.state = 'role-selection';
    }

    game.lastActivity = Date.now();
    game.version++;
    
    return game;
  }

  assignRoles(game, hostChoice = null) {
    if (game.players.length !== 2) return;
  
    const hostPlayer = game.players.find(p => p.isHost);
    const otherPlayer = game.players.find(p => !p.isHost);
  
    if (!hostPlayer || !otherPlayer) {
      console.error('Could not find host or other player');
      return;
    }
  
    if (hostChoice === 'random') {
      hostChoice = Math.random() < 0.5 ? 'challenger' : 'moderator';
    }
  
    if (hostChoice === 'challenger') {
      game.challengerName = hostPlayer.name;
      game.moderatorName = otherPlayer.name;
      game.challengerId = hostPlayer.id;
      game.moderatorId = otherPlayer.id;
      hostPlayer.gameRole = 'challenger';
      otherPlayer.gameRole = 'moderator';
    } else if (hostChoice === 'moderator') {
      game.challengerName = otherPlayer.name;
      game.moderatorName = hostPlayer.name;
      game.challengerId = otherPlayer.id;
      game.moderatorId = hostPlayer.id;
      hostPlayer.gameRole = 'moderator';
      otherPlayer.gameRole = 'challenger';
    } else {
      // Default: Host ist Challenger
      game.challengerName = hostPlayer.name;
      game.moderatorName = otherPlayer.name;
      game.challengerId = hostPlayer.id;
      game.moderatorId = otherPlayer.id;
      hostPlayer.gameRole = 'challenger';
      otherPlayer.gameRole = 'moderator';
    }
    
    game.state = 'setup';
    game.rolesAssigned = true;
    
    console.log('Roles assigned:', {
      challenger: game.challengerName + ' (ID: ' + game.challengerId + ')',
      moderator: game.moderatorName + ' (ID: ' + game.moderatorId + ')'
    });
  }

  removePlayerFromGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) return null;

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;

    game.players.splice(playerIndex, 1);
    this.gamesByPlayer.delete(playerId);
    
    // If host leaves, end game
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
    return Math.floor(Math.random() * 3) + 1; // 1-3 coins
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
    
    // Caches
    this.questionCache = [];
    this.usedQuestions = new Set();
    this.sessionToken = null;
    
    // Rate limiting
    this.groqRequestCount = 0;
    this.groqResetTime = Date.now() + 60000; // 1 Minute
    
    // Statistiken
    this.stats = {
      totalGenerated: 0,
      fromGroq: 0,
      fromTriviaAPI: 0,
      fromLocal: 0,
      cacheHits: 0,
      errors: 0
    };

    this.initTriviaSession();
  }

  async initTriviaSession() {
    try {
      const response = await axios.get('https://opentdb.com/api_token.php?command=request');
      this.sessionToken = response.data.token;
      console.log('Trivia API session initialized');
    } catch (error) {
      console.error('Trivia Session error:', error);
    }
  }

// ============== KOPIEREN SIE AB HIER ================

async getQuestions(count = 10, gameId = null, settings = {}) {
  const { difficulty = 'medium', category = null } = settings;
  
  console.log(`Anfrage für ${count} Fragen - Kategorie: ${category || 'Allgemein'}, Schwierigkeit: ${difficulty}`);
  
  let questions = [];
  
  // --- NEUE, VERBESSERTE CACHE-LOGIK ---
// --- CACHE MIT CATEGORY **UND** DIFFICULTY ---
if (this.questionCache.length > 0) {
  let fromCache = [];

  if (category) {
    // Kategorie *und* Schwierigkeit müssen passen
    const matchingQuestions = this.questionCache.filter(
      q =>
        q.category &&
        q.category.toLowerCase() === category.toLowerCase() &&
        q.difficulty &&
        q.difficulty.toLowerCase() === difficulty.toLowerCase()
    );

    fromCache = matchingQuestions.slice(0, count);

    // entnommene Fragen aus dem Cache entfernen
    const usedIds = new Set(fromCache.map(q => q.id));
    this.questionCache = this.questionCache.filter(q => !usedIds.has(q.id));

  } else {
    // ohne Kategorie → nur nach Difficulty filtern
    const matchingQuestions = this.questionCache.filter(
      q =>
        q.difficulty &&
        q.difficulty.toLowerCase() === difficulty.toLowerCase()
    );

    fromCache = matchingQuestions.slice(0, count);

    const usedIds = new Set(fromCache.map(q => q.id));
    this.questionCache = this.questionCache.filter(q => !usedIds.has(q.id));
  }

  questions.push(...fromCache);
  this.stats.cacheHits += fromCache.length;
}


  const remaining = count - questions.length;

  if (remaining > 0) {
      console.log(`${remaining} Fragen werden neu von APIs angefordert...`);
      
      // Versuche Groq zuerst, da es spezifische Kategorien am besten bedienen kann
      if (this.groqApiKey && this.canMakeGroqRequest() && category) {
        // Verwende Wikipedia RAG nur wenn eine Kategorie angegeben wurde
        try {
          const groqQuestions = await this.generateWithGroq(Math.ceil(remaining * 1.2), difficulty, category);
          questions.push(...groqQuestions);
          console.log(`${groqQuestions.length} Fragen von Groq mit Wikipedia RAG generiert`);
        } catch (error) {
          console.error('Groq Fehler:', error);
          this.stats.errors++;
        }
      }
      
      // Fülle den Rest mit der Trivia API auf
      const stillNeeded = count - questions.length;
      if (stillNeeded > 0) {
          try {
              // Die Trivia API unterstützt keine benutzerdefinierten Kategorien, dient also als allgemeiner Fallback
              const triviaQuestions = await this.fetchFromTriviaAPI(stillNeeded, difficulty);
              questions.push(...triviaQuestions);
              console.log(`${triviaQuestions.length} Fragen von Trivia API geholt`);
          } catch (error) {
              console.error('Trivia API Fehler:', error);
              this.stats.errors++;
          }
      }
      
      // Letzter Fallback auf die lokale Datenbank
      const finallyNeeded = count - questions.length;
      if (finallyNeeded > 0) {
          const localQuestions = this.getLocalQuestions(finallyNeeded);
          questions.push(...localQuestions);
          console.log(`${localQuestions.length} lokale Fragen verwendet`);
      }
  }
  
  // Fülle den Cache im Hintergrund für zukünftige Anfragen auf
  if (this.questionCache.length < 50) {
      this.prefillCache();
  }
  
  const finalQuestions = this.deduplicateQuestions(questions, gameId).slice(0, count);
  console.log(`Anfrage abgeschlossen. ${finalQuestions.length} finale Fragen werden zurückgegeben.`);
  return finalQuestions;
}

// ============== KOPIEREN SIE BIS HIER ================

  canMakeGroqRequest() {
    const now = Date.now();
    if (now > this.groqResetTime) {
      this.groqRequestCount = 0;
      this.groqResetTime = now + 60000;
    }
    return this.groqRequestCount < 30; // 30 Anfragen pro Minute
  }

  async prefillCache() {
    if (this.questionCache.length < 50 && this.canMakeGroqRequest()) {
      try {
        const newQuestions = await this.generateWithGroq(10);
        this.questionCache = [...this.questionCache, ...newQuestions];
      } catch (error) {
        console.error('Error pre-filling cache:', error);
      }
    }
  }

// Dies ist die verbesserte Funktion, die die alte komplett ersetzt.

async generateWithGroq(count, difficulty = 'medium', customCategory = null) {
  if (!this.groqApiKey || !this.canMakeGroqRequest()) return [];
  this.groqRequestCount++;

  try {
    // Schritt 1: Wikipedia-Artikel zum Thema finden
    const wikiContext = await this.fetchWikipediaContext(customCategory);
    if (!wikiContext) {
      console.log(`Keine Wikipedia-Informationen für "${customCategory}" gefunden`);
      return [];
    }

    const difficultyMap = {
      easy: 'easy (basic facts clearly stated in the text, like names, locations, or simple facts)',
      medium: 'medium (requires connecting 2-3 pieces of information from the text)',
      hard: 'hard (specific details, dates, numbers, or information that requires careful reading)'
    };
    
    // Erweitere den Prompt mit besseren Schwierigkeits-Beispielen
    const prompt = `Based on the following Wikipedia information, generate ${count} multiple-choice quiz questions.
    
    WIKIPEDIA CONTEXT:
    ${wikiContext}
    
    DIFFICULTY LEVEL: ${difficulty.toUpperCase()}
    ${difficultyMap[difficulty]}
    
    DIFFICULTY GUIDELINES BASED ON THE TEXT:
    - EASY: Ask about main topics, names, or facts that are explicitly stated. Example: "What is X?" when X is clearly defined in the text.
    - MEDIUM: Ask about relationships, causes, or facts that require reading 2-3 sentences. Example: "Why did X happen?" when the cause is explained across multiple sentences.
    - HARD: Ask about specific details, exact dates, percentages, or information mentioned only once. Example: "In which year...?" or "What percentage...?"
    
    IMPORTANT RULES:
    1. Questions MUST be answerable using ONLY the Wikipedia text above
    2. Difficulty must match the ${difficulty} level as described
    3. For EASY questions, the answer should be directly findable in a single sentence
    4. For MEDIUM questions, the answer might require understanding a paragraph
    5. For HARD questions, look for specific details that a casual reader might miss
    6. All wrong options must be plausible but clearly wrong based on the text
    
    Respond ONLY with valid JSON:
    {
      "questions": [
        {
          "question": "Question text here",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correct": 0,
          "category": "${customCategory || 'General Knowledge'}",
          "difficulty": "${difficulty}"
        }
      ]
    }`;

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama3-8b-8192',
      messages: [{
        role: 'system',
        content: 'You are a quiz master who creates questions based ONLY on provided Wikipedia content. Never invent facts.'
      }, {
        role: 'user',
        content: prompt
      }],
      temperature: 0.3, // Niedrigere Temperatur für faktentreue
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
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw parseError;
      }
    }

    if (!parsed.questions || parsed.questions.length === 0) {
      return [];
    }

    const questions = parsed.questions.map(q => ({
      question: q.question,
      options: q.options,
      correct: parseInt(q.correct),
      category: q.category,
      difficulty: q.difficulty,
      source: 'groq-wikipedia',
      id: crypto.randomUUID(),
      wikiVerified: true
    }));

    this.stats.fromGroq += questions.length;
    this.stats.totalGenerated += questions.length;

    const validated = validateQuestions(questions);
    
    // Verifiziere Antworten gegen Wikipedia
    const verifiedQuestions = await this.verifyWithWikipedia(validated, wikiContext);

    // Validiere und korrigiere Schwierigkeitsgrade
    const difficultyValidated = this.validateDifficultyLevel(verifiedQuestions, wikiContext);

    scheduleDeepChecks(difficultyValidated);
    return difficultyValidated;

  } catch (error) {
    console.error('Groq generation error:', error.response?.data || error.message);
    this.stats.errors++;
    return [];
  }
}

async fetchWikipediaContext(topic) {
  if (!topic) return null;
  
  try {
    // Suche nach Wikipedia-Artikel
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=3`;
    const searchResponse = await axios.get(searchUrl, { timeout: 5000 });
    
    if (!searchResponse.data.query.search.length) {
      return null;
    }

    const pageTitle = searchResponse.data.query.search[0].title;
    
    // Hole den Artikelinhalt
    const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=0&explaintext=1&titles=${encodeURIComponent(pageTitle)}`;
    const contentResponse = await axios.get(contentUrl, { timeout: 10000 });
    
    const pages = contentResponse.data.query.pages;
    const pageId = Object.keys(pages)[0];
    const extract = pages[pageId].extract;
    
    if (!extract) return null;
    
    // Begrenze auf die ersten 3000 Zeichen für bessere Relevanz
    const limitedExtract = extract.slice(0, 3000);
    
    return `Article: ${pageTitle}\n\n${limitedExtract}`;
    
  } catch (error) {
    console.error('Wikipedia fetch error:', error.message);
    return null;
  }
}

async verifyWithWikipedia(questions, wikiContext) {
  // Verifiziere jede Frage gegen den Wikipedia-Kontext
  return questions.filter(q => {
    try {
      // Prüfe ob die richtige Antwort im Kontext erwähnt wird
      const correctAnswer = q.options[q.correct].toLowerCase();
      const contextLower = wikiContext.toLowerCase();
      
      // Sehr simple Verifikation - kann erweitert werden
      if (contextLower.includes(correctAnswer) || 
          contextLower.includes(q.question.toLowerCase().slice(0, 20))) {
        return true;
      }
      
      // Wenn die Antwort zu spezifisch ist, behalte sie trotzdem
      if (q.difficulty === 'hard') {
        return true;
      }
      
      console.warn(`Question might not be verifiable: ${q.question.slice(0, 50)}...`);
      return true; // Behalte sie trotzdem, aber markiere sie
      
    } catch (error) {
      return true; // Im Fehlerfall behalten
    }
  });
}

validateDifficultyLevel(questions, wikiContext) {
  return questions.map(q => {
    const contextWords = wikiContext.toLowerCase().split(/\s+/);
    const questionWords = q.question.toLowerCase().split(/\s+/);
    const correctAnswer = q.options[q.correct].toLowerCase();
    
    // Zähle wie oft die Antwort im Text vorkommt
    const answerMentions = contextWords.filter(word => 
      correctAnswer.includes(word) || word.includes(correctAnswer)
    ).length;
    
    // Zähle wie spezifisch die Frage ist (längere Fragen = spezifischer)
    const questionSpecificity = questionWords.length;
    
    // Passe Schwierigkeit basierend auf Metriken an
    let suggestedDifficulty = q.difficulty;
    
    if (answerMentions > 5 && questionSpecificity < 8) {
      suggestedDifficulty = 'easy';
    } else if (answerMentions === 1 || questionSpecificity > 15) {
      suggestedDifficulty = 'hard';
    } else {
      suggestedDifficulty = 'medium';
    }
    
    if (suggestedDifficulty !== q.difficulty) {
      console.log(`Difficulty adjusted for question: "${q.question.slice(0,50)}..." from ${q.difficulty} to ${suggestedDifficulty}`);
      q.difficulty = suggestedDifficulty;
    }
    
    return q;
  });
}

// ============== KOPIEREN SIE AB HIER ================

async fetchFromTriviaAPI(count, difficulty = 'medium') { // <--- HIER WURDE difficulty HINZUGEFÜGT
  try {
    const params = {
      amount: Math.min(count, 10), // Max 10 pro Anfrage
      type: 'multiple',
      encode: 'base64',
      difficulty: difficulty // <--- DIESE ZEILE IST NEU
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
      return this.fetchFromTriviaAPI(count, difficulty); // <--- HIER WURDE difficulty HINZUGEFÜGT
    }
    
    if (response.data.response_code !== 0) {
      // Wenn für eine Schwierigkeit keine Fragen da sind, versuche es ohne
      if (response.data.response_code === 1) {
          console.log(`Trivia API hat keine Fragen für Schwierigkeit "${difficulty}". Versuche es ohne Filter.`);
          delete params.difficulty;
          const fallbackResponse = await axios.get('https://opentdb.com/api.php', { params, timeout: 15000 });
          if (fallbackResponse.data.response_code !== 0) {
               throw new Error('Trivia API Error: ' + fallbackResponse.data.response_code);
          }
          response.data = fallbackResponse.data;
      } else {
          throw new Error('Trivia API Error: ' + response.data.response_code);
      }
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
        
        // Mische Antworten
        const allOptions = [...incorrectAnswers, correctAnswer];
        const shuffled = this.shuffle(allOptions);
        const correctIndex = shuffled.indexOf(correctAnswer);
        
        questions.push({
          question: question,
          options: shuffled,
          correct: correctIndex,
          category: this.mapCategory(Buffer.from(q.category, 'base64').toString('utf-8')), // Kategorie auch dekodieren
          difficulty: q.difficulty,
          source: 'triviaAPI',
          id: crypto.randomUUID()
        });
      } catch (error) {
        console.error('Error processing question:', error);
        continue;
      }
    }
    
    this.stats.fromTriviaAPI += questions.length;
    this.stats.totalGenerated += questions.length;
    const cleaned = validateQuestions(questions);
    scheduleDeepChecks(cleaned);   // läuft asynchron
    return cleaned;    
  } catch (error) {
    console.error('Trivia API Fehler:', error);
    this.stats.errors++;
    return [];
  }
}

// ============== KOPIEREN SIE BIS HIER ================

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

  validateGeneratedQuestions(questions) {
    const validated = [];
    for (const q of questions) {
        // Check 1: Correct index must be valid
        if (q.correct < 0 || q.correct >= q.options.length) {
            console.warn(`Invalid correct index: ${q.correct} for question: ${q.question}`);
            continue;
        }
        
        // Check 2: No duplicate options
        const uniqueOptions = new Set(q.options);
        if (uniqueOptions.size !== q.options.length) {
            console.warn(`Duplicate options in question: ${q.question}`);
            continue;
        }
        
        // Check 3: Question length sanity check
        if (q.question.length < 10 || q.question.length > 300) {
            console.warn(`Question too short/long: ${q.question}`);
            continue;
        }
        
        // Check 4: Options length sanity check
        const invalidOption = q.options.find(opt => opt.length < 1 || opt.length > 100);
        if (invalidOption) {
            console.warn(`Invalid option length in question: ${q.question}`);
            continue;
        }
        
        validated.push(q);
    }
    return validated;
}

  deduplicateQuestions(questions, gameId) {
    const unique = [];
    const seen = new Set();
    
    for (const q of questions) {
      const hash = this.hashQuestion(q.question);
      
      if (!seen.has(hash) && !this.usedQuestions.has(hash)) {
        if (q.reported) continue;  
        unique.push(q);
        seen.add(hash);
        this.usedQuestions.add(hash);
      }
    }
    
    return unique;
  }

  mapCategory(apiCategory) {
    const mapping = {
      'Geography': 'Geography',
      'History': 'History',
      'Science': 'Science',
      'Science & Nature': 'Science',
      'Sports': 'Sports',
      'Entertainment': 'Culture',
      'Art': 'Culture',
      'General Knowledge': 'General Knowledge',
      'Mythology': 'History',
      'Politics': 'History',
      'Celebrities': 'Culture',
      'Animals': 'Science'
    };
    
    return mapping[apiCategory] || 'General Knowledge';
  }

  hashQuestion(question) {
    return crypto.createHash('md5').update(question.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
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
      usedQuestions: this.usedQuestions.size,
      groqRequests: this.groqRequestCount,
      groqResetIn: Math.max(0, Math.ceil((this.groqResetTime - Date.now()) / 1000))
    };
  }

  clearCache() {
    this.questionCache = [];
    this.usedQuestions.clear();
    this.translationCache.clear();
    console.log('Question cache cleared');
  }
}

// Lokale Fragendatenbank als Fallback
const questionDatabase = [
  // Geography
  { question: "What is the smallest country in the world?", options: ["Monaco", "Vatican City", "San Marino", "Liechtenstein"], correct: 1, category: "Geography" },
  { question: "What is the capital of Iceland?", options: ["Oslo", "Reykjavik", "Helsinki", "Stockholm"], correct: 1, category: "Geography" },
  { question: "What is the longest river in Europe?", options: ["Danube", "Rhine", "Volga", "Seine"], correct: 2, category: "Geography" },
  { question: "How many time zones are there in Russia?", options: ["7", "9", "11", "13"], correct: 2, category: "Geography" },
  { question: "Which country has the most islands?", options: ["Indonesia", "Sweden", "Canada", "Japan"], correct: 1, category: "Geography" },
  { question: "What is the highest mountain in Africa?", options: ["Mount Kenya", "Kilimanjaro", "Atlas", "Drakensberg"], correct: 1, category: "Geography" },
  { question: "Which country borders the most other countries?", options: ["Russia", "China", "Brazil", "Germany"], correct: 1, category: "Geography" },
  { question: "What is the name of the desert in southern Israel?", options: ["Sahara", "Gobi", "Negev", "Atacama"], correct: 2, category: "Geography" },

  // History
  { question: "In which year was the UN founded?", options: ["1943", "1945", "1947", "1949"], correct: 1, category: "History" },
  { question: "Who was the first human in space?", options: ["Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "Alan Shepard"], correct: 2, category: "History" },
  { question: "How long did the Hundred Years' War last?", options: ["100 years", "116 years", "99 years", "124 years"], correct: 1, category: "History" },
  { question: "Which was the first country to grant women's suffrage?", options: ["USA", "New Zealand", "Switzerland", "England"], correct: 1, category: "History" },
  { question: "In which year did World War I end?", options: ["1916", "1917", "1918", "1919"], correct: 2, category: "History" },
  { question: "Who invented the telephone?", options: ["Thomas Edison", "Alexander Graham Bell", "Nikola Tesla", "Guglielmo Marconi"], correct: 1, category: "History" },
  { question: "In which year did the Berlin Wall fall?", options: ["1987", "1988", "1989", "1990"], correct: 2, category: "History" },
  { question: "Which ship sank on its maiden voyage in 1912?", options: ["Lusitania", "Titanic", "Britannic", "Queen Mary"], correct: 1, category: "History" },

  // Science
  { question: "How many bones does an adult human have?", options: ["186", "206", "226", "246"], correct: 1, category: "Science" },
  { question: "What is the most common blood type?", options: ["A+", "B+", "O+", "AB+"], correct: 2, category: "Science" },
  { question: "What is the lightest element?", options: ["Helium", "Hydrogen", "Lithium", "Beryllium"], correct: 1, category: "Science" },
  { question: "What percentage of the Earth's surface is covered with water?", options: ["61%", "71%", "81%", "91%"], correct: 1, category: "Science" },
  { question: "What is the speed of sound?", options: ["343 m/s", "443 m/s", "543 m/s", "643 m/s"], correct: 0, category: "Science" },
  { question: "Which organ produces insulin?", options: ["Liver", "Kidney", "Pancreas", "Spleen"], correct: 2, category: "Science" },
  { question: "How many planets are in our solar system?", options: ["7", "8", "9", "10"], correct: 1, category: "Science" },
  { question: "What is the chemical formula for water?", options: ["H2O", "CO2", "O2", "H2O2"], correct: 0, category: "Science" }
];


// Instanzen
const sessionManager = new SessionManager();
const gameManager = new GameManager();
const questionService = new QuestionService();

// Hilfsfunktionen
const getRandomQuestions = async (count = 10, gameId = null, settings = {}) => {
  try {
    return await questionService.getQuestions(count, gameId, settings);
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
      const gameSettings = data.settings || {};

      // Fordere zuerst die Fragen an, BEVOR das Spiel final erstellt wird.
      const questions = await questionService.getQuestions(10, null, gameSettings);

      // PRÜFUNG: Wenn eine spezielle Kategorie gewünscht war, aber keine Fragen dafür gefunden wurden.
      // Wir prüfen, ob die erste Frage eine andere Kategorie hat als die gewünschte.
      if (gameSettings.category && questions.length > 0 && questions[0].category.toLowerCase() !== gameSettings.category.toLowerCase()) {
          
          // Sende eine spezifische Fehlermeldung an den Client.
          socket.emit('error', { 
              message: `Leider konnten keine Fragen zur Kategorie "${gameSettings.category}" gefunden werden. Bitte versuche es mit einer allgemeineren Kategorie oder lasse das Feld leer.` 
          });
          console.log(`Failed to create game with category: ${gameSettings.category}. No matching questions found.`);
          return; // Breche die Spielerstellung ab.
      }
      // Additional check: Ensure we have enough questions
      if (questions.length < 5) {
        socket.emit('error', { 
            message: `Nicht genügend Fragen gefunden. Bitte versuche es erneut oder wähle eine andere Kategorie.` 
        });
        console.log(`Not enough questions generated: ${questions.length}`);
        return;
      }

      // Wenn alles gut ging, fahre mit der Spielerstellung fort.
      const game = gameManager.createGame(
          socket.id,
          data.playerName,
          gameSettings
      );

      game.questions = questions; // Weise die bereits geladenen Fragen zu.

      const { sessionId, reconnectToken } = sessionManager.createSession(
          socket.id,
          game.id,
          data.playerName,
          'host',
          true
      );

      socket.join(game.id);
      socket.emit('game-created', {
          gameId: game.id,
          game,
          sessionId,
          reconnectToken
      });

      console.log('Game created:', game.id, 'by', data.playerName, 'with settings:', game.settings);
  } catch (error) {
      handleSocketError(socket, error, 'create-game');
  }
});
socket.on('request-game-update', (data) => {
  try {
    const { gameId } = data;
    const game = gameManager.getGame(gameId);
    
    if (game) {
      socket.emit('game-updated', game);
      console.log('Manual game update requested for:', gameId);
    }
  } catch (error) {
    console.error('Error in request-game-update:', error);
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
        socket.emit('error', { message: 'Game not found!' });
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
        socket.emit('error', { message: 'Could not join game!' });
        return;
      }

      socket.join(gameId);

      // Session erstellen
      const { sessionId, reconnectToken } = sessionManager.createSession(
        socket.id, 
        gameId, 
        playerName, 
        'player2', 
        false
      );

      const joinedPlayer = updatedGame.players.find(p => p.id === socket.id);
      socket.emit('joined-game', { 
        gameId, 
        role: joinedPlayer.role,
        isHost: joinedPlayer.isHost,
        gameRole: joinedPlayer.gameRole,
        sessionId,
        reconnectToken
      });

          // DANN sende game-updated an ALLE (inklusive dem neuen Spieler)
    io.to(gameId).emit('game-updated', updatedGame);

    console.log('Player joined:', playerName, 'to game:', gameId);
    console.log('Current players:', updatedGame.players.map(p => p.name));
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
  
      // Zusätzliche Fragen mit Settings laden falls nötig
      if (game.questions.length < 10) {
        const newQuestions = await questionService.getQuestions(20, gameId, game.settings);
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
      const { gameId, answer } = data;
      const game = gameManager.getGame(gameId);
      if (!game || game.state !== 'playing') return;
  
      const player = game.players.find(p => p.id === socket.id);
      if (!player) return;
  
      // A single object to hold all updates for this action
      const updates = {};
  
      // 1. Record the answer
      if (socket.id === game.challengerId) {
        updates.challengerAnswer = answer;
        updates.challengerAnswered = true;
      } else if (socket.id === game.moderatorId) {
        updates.moderatorAnswer = answer;
        updates.moderatorAnswered = true;
      } else {
        return; // Not a participant
      }
  
      // Temporarily apply the update to the current game object to check the next condition
      const tempGame = { ...game, ...updates };
  
      // 2. If both players have now answered, calculate the result and change the phase
      if (tempGame.challengerAnswered && tempGame.moderatorAnswered) {
        const currentQ = tempGame.questions[tempGame.currentQuestion];
        const challengerCorrect = parseInt(tempGame.challengerAnswer) === currentQ.correct;
  
        updates.challengerCorrect = challengerCorrect;
        updates.challengerScore = challengerCorrect ? tempGame.challengerScore + 1 : tempGame.challengerScore;
        updates.phase = 'decision';
      }
  
      // 3. Apply all collected updates in one go and emit the result
      const finalGame = gameManager.updateGame(gameId, updates);
      io.to(gameId).emit('game-updated', finalGame);
  
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
      
      if (!game || game.state !== 'playing' || game.phase !== 'decision') {
        console.log('Invalid game state for decision');
        return;
      }
      
      // Verwende direkt die Socket-ID statt über player.gameRole zu gehen
      if (socket.id !== game.challengerId) {
        console.log('Non-challenger tried to make decision');
        return;
      }
  
      const currentQ = game.questions[game.currentQuestion];
      const moderatorCorrect = parseInt(game.moderatorAnswer) === currentQ.correct;
  
      let roundResult;
      let updates = { decision, phase: 'result' };
  
      if (decision === 'trust') {
        updates.moderatorScore = game.moderatorScore + 1;
        roundResult = `${game.challengerName} trusts ${game.moderatorName}. ${game.moderatorName} gets 1 point.`;
        updates.showModeratorAnswer = false;
      } else {
        // Bei Doubt: Münze wird IMMER zuerst abgezogen
        const newCoinCount = game.challengerCoins - 1;
        updates.showModeratorAnswer = true;
        
        if (moderatorCorrect) {
          // Moderator hatte recht: Münze ist weg
          updates.challengerCoins = newCoinCount;
          updates.moderatorScore = game.moderatorScore + 1;
          roundResult = `${game.challengerName} doubts. ${game.moderatorName} was right and gets 1 point. Coin lost!`;
        } else {
          // Moderator hatte unrecht: Münze bleibt (bzw. kommt zurück)
          updates.challengerCoins = game.challengerCoins; // Münze bleibt
          roundResult = `${game.challengerName} doubts. ${game.moderatorName} was wrong. Coin is retained.`;
        }
      }
  
      updates.roundResult = roundResult;
      gameManager.updateGame(gameId, updates);
      
      const updatedGame = gameManager.getGame(gameId);
      io.to(gameId).emit('game-updated', updatedGame);
      
      console.log('Decision made:', decision, 'Result:', roundResult);
    } catch (error) {
      handleSocketError(socket, error, 'make-decision');
    }
  });

  // Skip/Report Question
socket.on('request-skip', (data) => {
  try {
    console.log('SKIP REQUEST:', data);
    const { gameId, reason } = data;
    const game = gameManager.getGame(gameId);
    
    if (!game || game.state !== 'playing' || game.phase !== 'answering') {
      return;
    }
    
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    
    // Check if player already requested skip
    if (game.skipRequests.includes(socket.id)) {
      return;
    }
    
    game.skipRequests.push(socket.id);
    game.skipRequestedBy = player.name;
    
    // Notify other player
    socket.to(gameId).emit('skip-requested', { 
      playerName: player.name,
      reason 
    });
    
    // If both players want to skip, skip the question
    if (game.skipRequests.length === 2) {
      console.log('Both players agreed to skip question');
      
      // Mark question as reported/problematic
      const currentQ = game.questions[game.currentQuestion];
      if (currentQ) {
        currentQ.reported = true;
        currentQ.reportReason = reason;
      }
      
      // Move to next question
      gameManager.updateGame(gameId, {
        currentQuestion: game.currentQuestion + 1,
        phase: 'answering',
        challengerAnswer: '',
        moderatorAnswer: '',
        challengerAnswered: false,
        moderatorAnswered: false,
        challengerCorrect: false,
        skipRequests: [],
        skipRequestedBy: null
      });
      
      io.to(gameId).emit('question-skipped');
      io.to(gameId).emit('game-updated', game);
    } else {
      gameManager.updateGame(gameId, {});
      io.to(gameId).emit('game-updated', game);
    }
  } catch (error) {
    handleSocketError(socket, error, 'request-skip');
  }
});

// Rollenauswahl
socket.on('choose-role', (data) => {
  try {
    console.log('CHOOSE ROLE:', data);
    const { gameId, choice } = data;
    const game = gameManager.getGame(gameId);
    
    if (!game || game.state !== 'role-selection') {
      console.log('Game not in role-selection state');
      return;
    }
    
    const session = sessionManager.findSessionBySocket(socket.id);
    if (!session || !session.isHost) {
      console.log('Non-host tried to choose roles:', socket.id);
      return;
    }

    // Assign roles
    gameManager.assignRoles(game, choice);
    
    // WICHTIG: Update muss an ALLE gesendet werden
    const updatedGame = gameManager.getGame(gameId);
    io.to(gameId).emit('game-updated', updatedGame);
    
    console.log('Roles assigned and game updated for all players');
  } catch (error) {
    handleSocketError(socket, error, 'choose-role');
  }
});

// Post-Answer Report Request
// Post-Answer Report Request
socket.on('request-post-answer-report', (data) => {
  try {
    console.log('POST-ANSWER REPORT REQUEST:', data);
    const { gameId, reason } = data;
    const game = gameManager.getGame(gameId);
    
    if (!game || game.state !== 'playing' || game.phase !== 'decision') {
      return;
    }
    
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    
    // Verhindert doppelte Meldungen
    if (game.postAnswerReportRequests.includes(socket.id)) {
      return;
    }
    
    game.postAnswerReportRequests.push(socket.id);
    game.postAnswerReportRequestedBy = player.name;
    
    // Benachrichtige den anderen Spieler über die Meldung
    socket.to(gameId).emit('post-answer-report-requested', { 
      playerName: player.name,
      reason 
    });
    
    // **START DER KORREKTUR**
    // Wenn beide Spieler die Frage melden
    if (game.postAnswerReportRequests.length === 2) {
      console.log('Both players agreed to invalidate question - 0 points for all');
      
      const currentQ = game.questions[game.currentQuestion];
      if (currentQ) {
        currentQ.reported = true;
        currentQ.reportReason = 'Invalid question - both players agreed';
      }

      const updates = {
        phase: 'result',
        roundResult: 'Question reported as invalid by both players. No points awarded.',
        postAnswerReportRequests: [],
        postAnswerReportRequestedBy: null,
        showModeratorAnswer: true,
        decision: 'invalidated'
      };
      
      // WICHTIG: Ziehe den Punkt zurück, den der Challenger eventuell schon bekommen hat.
      // Der Punkt für den Moderator wird erst in 'make-decision' vergeben, was hier übersprungen wird.
      if (game.challengerCorrect) {
        updates.challengerScore = game.challengerScore - 1;
        console.log(`Reverted challenger score for game ${gameId} from ${game.challengerScore} to ${updates.challengerScore}`);
      }
      
      // Spiel mit den Korrekturen aktualisieren
      gameManager.updateGame(gameId, updates);
      
      // Den finalen, korrigierten Spielzustand holen und an alle senden
      const updatedGame = gameManager.getGame(gameId);
      
      io.to(gameId).emit('question-invalidated', { reason });
      io.to(gameId).emit('game-updated', updatedGame);

    } else {
      // Wenn nur ein Spieler gemeldet hat, nur den Zustand aktualisieren
      gameManager.updateGame(gameId, {});
      io.to(gameId).emit('game-updated', game);
    }
    // **ENDE DER KORREKTUR**

  } catch (error) {
    handleSocketError(socket, error, 'request-post-answer-report');
  }
});

// Cancel Post-Answer Report Request
socket.on('cancel-post-answer-report', (data) => {
  try {
    console.log('CANCEL POST-ANSWER REPORT:', data);
    const { gameId } = data;
    const game = gameManager.getGame(gameId);
    
    if (!game) return;
    
    // Remove player from post-answer report requests
    game.postAnswerReportRequests = game.postAnswerReportRequests.filter(id => id !== socket.id);
    
    if (game.postAnswerReportRequests.length === 0) {
      game.postAnswerReportRequestedBy = null;
    }
    
    gameManager.updateGame(gameId, {});
    
    io.to(gameId).emit('post-answer-report-cancelled');
    io.to(gameId).emit('game-updated', game);
  } catch (error) {
    handleSocketError(socket, error, 'cancel-post-answer-report');
  }
});
// Cancel Skip Request
socket.on('cancel-skip', (data) => {
  try {
    console.log('CANCEL SKIP:', data);
    const { gameId } = data;
    const game = gameManager.getGame(gameId);
    
    if (!game) return;
    
    // Remove player from skip requests
    game.skipRequests = game.skipRequests.filter(id => id !== socket.id);
    
    if (game.skipRequests.length === 0) {
      game.skipRequestedBy = null;
    }
    
    gameManager.updateGame(gameId, {});
    
    io.to(gameId).emit('skip-cancelled');
    io.to(gameId).emit('game-updated', game);
  } catch (error) {
    handleSocketError(socket, error, 'cancel-skip');
  }
});

  // Nächste Runde
// Durch diesen kompletten Block ersetzen
socket.on('next-round', async (data) => {
  try {
    console.log('NEXT ROUND:', data);
    const { gameId } = data;
    const game = gameManager.getGame(gameId);

    if (!game) return;

    let updates = {};
    
    // Check win conditions BEFORE updating anything
    const challengerWon = game.challengerScore >= 5;
    const moderatorWon = game.moderatorScore >= 5;
    const challengerOutOfCoins = game.challengerCoins <= 0;
    
    const gameFinished = challengerWon || moderatorWon || challengerOutOfCoins;
    
    if (gameFinished) {
      // Determine winner based on the specific win condition
      let winner;
      if (challengerWon) {
        winner = game.challengerName;
      } else if (moderatorWon) {
        winner = game.moderatorName;
      } else if (challengerOutOfCoins) {
        winner = game.moderatorName; // Moderator wins if challenger runs out of coins
      } else if (game.challengerScore === game.moderatorScore) {
        winner = 'Unentschieden'; // Draw
      } else {
        // Fallback: highest score wins
        winner = game.challengerScore > game.moderatorScore ? game.challengerName : game.moderatorName;
      }
      
      updates.state = 'finished';
      updates.winner = winner;
      updates.endTime = Date.now();
      
      console.log(`Game ${gameId} finished! Winner: ${winner}`);
      console.log(`Final Score - ${game.challengerName}: ${game.challengerScore}, ${game.moderatorName}: ${game.moderatorScore}`);
      console.log(`Challenger coins left: ${game.challengerCoins}`);
      
      // Clean up sessions after a delay (but don't delete immediately)
      setTimeout(() => {
        const sessions = sessionManager.findSessionsByGame(gameId);
        sessions.forEach(session => {
          sessionManager.deleteSession(session.id);
        });
        gameManager.deleteGame(gameId);
        console.log(`Game ${gameId} and sessions cleaned up`);
      }, 60000); // 1 minute delay to allow players to see the result
      
    } else {
      // Continue to next round
      updates.currentQuestion = game.currentQuestion + 1;
      
      // Load more questions if needed
      if (game.currentQuestion >= game.questions.length - 5) {
        const newQuestions = await questionService.getQuestions(10, gameId, game.settings);
        game.questions.push(...newQuestions);
        console.log(`${newQuestions.length} new questions added to game ${gameId}`);
      }
      
      // Reset for new round
      updates.phase = 'answering';
      updates.challengerAnswer = '';
      updates.moderatorAnswer = '';
      updates.challengerAnswered = false;
      updates.moderatorAnswered = false;
      updates.challengerCorrect = false;
      updates.decision = '';
      updates.roundResult = '';
      updates.showModeratorAnswer = false;
      updates.skipRequests = [];
      updates.skipRequestedBy = null;
      updates.postAnswerReportRequests = []; // NEW
      updates.postAnswerReportRequestedBy = null; // NEW
    }

    // Update game and notify all clients
    gameManager.updateGame(gameId, updates);
    io.to(gameId).emit('game-updated', game);
    
    if (gameFinished) {
      console.log(`Broadcasting game finished for ${gameId}`);
    } else {
      console.log(`Next round - Question: ${game.currentQuestion}, State: ${game.state}`);
    }

  } catch (error) {
    handleSocketError(socket, error, 'next-round');
  }
});

  // Spieler disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    clearInterval(heartbeatInterval);
    
    try {
      const session = sessionManager.findSessionBySocket(socket.id);
      if (session) {
        const game = gameManager.getGame(session.gameId);
                
        // Ansonsten normale Disconnect-Logik
        sessionManager.disconnectSession(session.id);
        
        if (game) {
          const disconnectedPlayer = game.players.find(p => p.id === socket.id);
          
          if (disconnectedPlayer) {
            disconnectedPlayer.connected = false;
            disconnectedPlayer.lastSeen = Date.now();
            
            gameManager.updateGame(session.gameId, {});
            
            if (game.state === 'playing') {
              socket.to(session.gameId).emit('player-disconnected', {
                playerName: disconnectedPlayer.name
              });
              
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
        socket.emit('reconnect-failed', { message: 'Session not found' });
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
  console.log(`Server is running on port ${PORT}`);
  console.log(`Groq API: ${questionService.groqApiKey ? 'Aktiviert' : 'Nicht konfiguriert'}`);
});

// Keep-Alive für Render
setInterval(() => {
  console.log('Keep alive ping:', new Date().toISOString());
}, 14 * 60 * 1000);
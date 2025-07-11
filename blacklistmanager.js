const fs = require('fs').promises;
const path = require('path');

const blacklistPath = path.join(__dirname, 'reported_questions.json');
let blacklist = new Set();

// Lädt die Blacklist beim Start des Servers in den Speicher.
async function loadBlacklist() {
    try {
        const data = await fs.readFile(blacklistPath, 'utf-8');
        const ids = JSON.parse(data);
        blacklist = new Set(ids);
        console.log(`[Blacklist] ${blacklist.size} gemeldete Fragen geladen.`);
    } catch (error) {
        // Wenn die Datei nicht existiert, ist das okay. Sie wird beim ersten Report erstellt.
        if (error.code === 'ENOENT') {
            console.log('[Blacklist] Keine Blacklist-Datei gefunden. Wird bei Bedarf erstellt.');
            return;
        }
        console.error('[Blacklist] Fehler beim Laden der Blacklist:', error);
    }
}

// Fügt eine neue ID hinzu und speichert die Datei.
async function reportQuestion(questionId) {
    if (!questionId || blacklist.has(questionId)) {
        return; // Nichts tun, wenn keine ID vorhanden oder bereits gemeldet.
    }

    blacklist.add(questionId);
    try {
        await fs.writeFile(blacklistPath, JSON.stringify([...blacklist]));
        console.log(`[Blacklist] Frage ${questionId} wurde gemeldet und gespeichert.`);
    } catch (error) {
        console.error('[Blacklist] Fehler beim Speichern der Blacklist:', error);
    }
}

// Gibt einfach das Set mit den geblockten IDs zurück.
function getBlacklist() {
    return blacklist;
}

module.exports = {
    loadBlacklist,
    reportQuestion,
    getBlacklist
};
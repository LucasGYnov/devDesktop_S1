// ============================================================
// main.js — Processus PRINCIPAL d'Electron
// ============================================================
//
// Une application Electron tourne dans DEUX processus séparés :
//
//   ┌─────────────────────────────────────────────────────┐
//   │  PROCESSUS MAIN (ce fichier)                        │
//   │  • Tourne dans Node.js (accès système complet)      │
//   │  • Crée les fenêtres                                │
//   │  • Lit/écrit des fichiers                           │
//   │  • Affiche dialogues, notifications, icône tray     │
//   │  • Stocke les préférences avec electron-store       │
//   └──────────────────┬──────────────────────────────────┘
//                      │  IPC (messages entre processus)
//   ┌──────────────────▼──────────────────────────────────┐
//   │  PROCESSUS RENDERER (index.html + renderer.js)      │
//   │  • Tourne dans Chromium (navigateur web)            │
//   │  • Gère l'interface utilisateur                     │
//   │  • N'a PAS accès direct à Node.js (sécurité)        │
//   └─────────────────────────────────────────────────────┘
//
// La communication entre les deux passe par preload.js
// qui joue le rôle de "pont sécurisé".
// ============================================================


// ─── 1. IMPORTS ─────────────────────────────────────────────
// On importe les modules nécessaires depuis Electron et Node.js.

const {
  app,           // Gère le cycle de vie de l'application (démarrage, arrêt…)
  BrowserWindow, // Crée et contrôle les fenêtres de l'application
  ipcMain,       // Écoute les messages envoyés par le renderer (IPC = Inter-Process Communication)
  dialog,        // Affiche des boîtes de dialogue natives (Ouvrir, Enregistrer…)
  Menu,          // Crée les menus natifs (barre de menu, menu contextuel)
  Tray,          // Crée une icône dans la barre système (system tray)
  Notification,  // Affiche des notifications système natives
  nativeImage    // Crée/manipule des images natives pour icônes, tray…
} = require('electron');

const path  = require('node:path');   // Module Node.js : gestion des chemins de fichiers
const fs    = require('node:fs');     // Module Node.js : lecture/écriture de fichiers
const Store = require('electron-store'); // Bibliothèque de stockage persistant (JSON chiffrable)


// ─── 2. STOCKAGE LOCAL ──────────────────────────────────────
// electron-store crée automatiquement un fichier JSON sur le disque
// (dans le dossier userData de l'OS) pour sauvegarder des données
// entre les sessions (préférences, historique, etc.)
// Exemple de chemin : ~/.config/api-natives-electron/config.json (Linux)
//                     %APPDATA%\api-natives-electron\config.json (Windows)
const store = new Store();


// ─── 3. VARIABLES GLOBALES ──────────────────────────────────
// Ces variables doivent être globales pour ne pas être
// "garbage-collectées" (supprimées de la mémoire) par JavaScript.
// Si elles étaient locales à une fonction, Electron fermerait la fenêtre.
let mainWindow; // Référence à la fenêtre principale
let tray;       // Référence à l'icône dans la barre système


// ─── 4. CRÉATION DE LA FENÊTRE ──────────────────────────────
// Cette fonction crée la fenêtre principale de l'application.
function createWindow() {

  // BrowserWindow = une fenêtre native avec un navigateur Chromium intégré
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      // preload.js est injecté dans la page AVANT que renderer.js ne s'exécute.
      // Il s'exécute dans un contexte "isolé" qui a accès à la fois
      // aux API Node.js ET au DOM de la page web.
      // C'est le seul endroit où on peut créer le pont sécurisé (contextBridge).
      preload: path.join(__dirname, 'preload.js')
      // Note : contextIsolation est true par défaut depuis Electron 12.
      // Cela empêche le renderer d'accéder directement à Node.js.
    }
  });

  // Charge la page HTML dans la fenêtre (comme un navigateur qui ouvre une URL)
  mainWindow.loadFile('index.html');

  // Crée la barre de menu native en haut de la fenêtre
  createMenu();

  // ── COMPORTEMENT À LA FERMETURE ──
  // Quand l'utilisateur clique sur la croix de la fenêtre,
  // au lieu de fermer l'application, on cache juste la fenêtre
  // (l'app continue de tourner en arrière-plan dans le tray).
  mainWindow.on('close', (event) => {
    event.preventDefault(); // Annule la fermeture normale
    mainWindow.hide();      // Cache la fenêtre (sans la détruire)
    // Pour vraiment quitter, l'utilisateur doit passer par le menu tray → "Quitter"
  });
}


// ─── 5. SYSTEM TRAY (icône barre des tâches) ────────────────
// Le "System Tray" est la zone d'icônes en bas à droite de l'écran
// (Windows) ou en haut à droite (macOS/Linux).
// Cela permet à l'application de rester accessible même quand
// la fenêtre est fermée/cachée.
function createTray() {

  // On cherche un fichier icon.png à la racine du projet.
  // __dirname = dossier où se trouve ce fichier (main.js)
  const iconPath = path.join(__dirname, 'icon.png');

  // Si l'icône existe, on la charge. Sinon, on utilise une image vide.
  // (Sur Linux/WSL l'icône vide peut ne pas être visible — ajouter un icon.png)
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath) // Charge l'image depuis le disque
    : nativeImage.createEmpty();           // Image transparente de secours

  // Crée l'icône dans la barre système
  tray = new Tray(icon);

  // Texte affiché quand on survole l'icône
  tray.setToolTip('Mon App Electron');

  // Menu contextuel affiché au clic droit sur l'icône
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Afficher',
      click: () => mainWindow.show() // Remet la fenêtre au premier plan
    },
    {
      label: 'Quitter',
      click: () => {
        // Avant de quitter, on supprime l'écouteur 'close' qu'on a ajouté
        // dans createWindow(), sinon app.quit() serait bloqué.
        mainWindow.removeAllListeners('close');
        app.quit(); // Ferme vraiment l'application
      }
    }
  ]));

  // Double-clic sur l'icône tray → affiche la fenêtre
  tray.on('double-click', () => mainWindow.show());
}


// ─── 6. MENU NATIF ──────────────────────────────────────────
// Crée la barre de menu affichée en haut de la fenêtre (ou de l'écran sur macOS).
function createMenu() {

  // buildFromTemplate prend un tableau d'objets décrivant le menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'Fichier',     // Titre du menu déroulant
      submenu: [
        {
          label: 'Nouveau',
          accelerator: 'CmdOrCtrl+N', // Raccourci clavier (Ctrl+O sur Win/Linux, Cmd+O sur Mac)
          // Appel direct à notre fonction : le main peut ouvrir le dialogue lui-même.
          // "void" sert à indiquer explicitement qu'on ignore la valeur retournée (promesse).
          click: () => { void newFileDialog(); }
        },
        {
          label: 'Ouvrir',
          accelerator: 'CmdOrCtrl+O', // Raccourci clavier (Ctrl+O sur Win/Linux, Cmd+O sur Mac)
          // Appel direct à notre fonction : le main peut ouvrir le dialogue lui-même.
          // "void" sert à indiquer explicitement qu'on ignore la valeur retournée (promesse).
          click: () => { void openFileDialog(); }
        },
        {
          label: 'Sauvegarder',
          accelerator: 'CmdOrCtrl+S',
          // Le contenu du texte se trouve dans le renderer (la page web), pas ici.
          // On envoie donc un signal au renderer pour lui demander de lancer la sauvegarde.
          // webContents.send = message envoyé du Main → Renderer
          click: () => mainWindow.webContents.send('menu-save')
        },
        { type: 'separator' }, // Ligne de séparation visuelle
        { label: 'Quitter', role: 'quit' } // role:'quit' = comportement natif de l'OS
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo'  }, // Annuler  (Ctrl+Z)
        { role: 'redo'  }, // Rétablir (Ctrl+Y)
        { type: 'separator' },
        { role: 'cut'   }, // Couper   (Ctrl+X)
        { role: 'copy'  }, // Copier   (Ctrl+C)
        { role: 'paste' }  // Coller   (Ctrl+V)
        // Les "roles" sont des actions prédéfinies par Electron,
        // avec le comportement et le texte natifs de chaque OS.
      ]
    }
  ]);

  // Définit ce menu comme le menu global de l'application
  Menu.setApplicationMenu(menu);
}


// ─── 7. OUVRIR UN FICHIER ───────────────────────────────────
// Fonction asynchrone (async) car dialog.showOpenDialog retourne une promesse.
// Elle est appelée :
//   a) depuis le menu (Fichier > Ouvrir ou Ctrl+O)
//   b) via IPC quand l'utilisateur clique sur le bouton "Ouvrir" dans la page
async function openFileDialog() {

  // Affiche la boîte de dialogue "Ouvrir un fichier" native de l'OS
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Texte', extensions: ['txt'] }], // Filtre : seulement les .txt
    properties: ['openFile'] // Mode sélection de fichier (pas de dossier)
  });

  // result.canceled = true si l'utilisateur a cliqué "Annuler"
  if (!result.canceled) {
    const filePath = result.filePaths[0]; // Chemin du fichier choisi

    // Lit le contenu du fichier de façon synchrone (bloquante ici, c'est ok car en main)
    const content = fs.readFileSync(filePath, 'utf-8');

    // Envoie le contenu ET le chemin au renderer via l'événement 'file-opened'
    // Le renderer écoute cet événement dans renderer.js (api.onFileOpened)
    mainWindow.webContents.send('file-opened', { content, filePath });

    return filePath; // Retourné à l'appelant IPC (le bouton du renderer attend ce résultat)
  }

  return null; // L'utilisateur a annulé → on retourne null
}

// Enregistre un gestionnaire IPC pour répondre au renderer quand il appelle api.ouvrir().
// ipcMain.handle = répond à ipcRenderer.invoke (système requête/réponse avec promesse)
ipcMain.handle('open-file-dialog', () => openFileDialog());


// ─── 8. SAUVEGARDER UN FICHIER ──────────────────────────────
// Gestionnaire IPC déclenché quand le renderer appelle api.sauvegarder(contenu).
// event  = informations sur l'émetteur (non utilisé ici)
// content = le texte envoyé par le renderer (contenu de l'éditeur)
ipcMain.handle('save-content', async (event, content) => {

  // Affiche la boîte de dialogue "Enregistrer sous" native de l'OS
  const result = await dialog.showSaveDialog({ defaultPath: 'doc.txt' });

  if (!result.canceled) {
    // Écrit le contenu dans le fichier choisi par l'utilisateur
    // writeFileSync = écriture synchrone (bloquante jusqu'à la fin)
    fs.writeFileSync(result.filePath, content);

    // Affiche une notification système native (en dehors de la fenêtre de l'app)
    // Cela utilise l'API de notifications de l'OS (Centre de notifications Windows,
    // libnotify sur Linux, etc.)
    new Notification({
      title: 'Terminé',          // Titre de la notification
      body:  'Fichier sauvegardé.' // Corps du message
    }).show(); // .show() déclenche l'affichage immédiat
  }
});


// ─── 9. STOCKAGE LOCAL — GESTIONNAIRES IPC ──────────────────
// Ces trois gestionnaires permettent au renderer de lire, écrire et supprimer
// des valeurs dans electron-store, sans avoir accès direct à Node.js.
//
// Syntaxe : store.get('clé', valeurParDéfaut)
//           store.set('clé', valeur)
//           store.delete('clé')
//
// Les clés peuvent être imbriquées avec des points :
//   'preferences.theme' → { preferences: { theme: 'dark' } }
//
// _e = premier argument (event IPC), non utilisé → convention de nommage avec _

ipcMain.handle('store-get',    (_e, key, def)   => store.get(key, def));
ipcMain.handle('store-set',    (_e, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (_e, key)        => store.delete(key));


// ─── 10. DÉMARRAGE DE L'APPLICATION ─────────────────────────
// app.whenReady() retourne une promesse qui se résout quand Electron
// a fini de s'initialiser et que l'application est prête à créer des fenêtres.
// C'est équivalent à l'événement DOMContentLoaded dans un navigateur.
app.whenReady().then(() => {
  createWindow(); // Crée et affiche la fenêtre principale
  createTray();   // Crée l'icône dans la barre système
});


// ─── 11. CRÉER UN NOUVEAU FICHIER ───────────────────────────
// Fonction asynchrone (async) appelée soit par le menu, soit par le renderer via IPC.
async function newFileDialog() {
  const content = ''; // Nouveau fichier = contenu vide

  // Affiche la boîte de dialogue "Enregistrer sous"
  const result = await dialog.showSaveDialog({ defaultPath: 'nouveau.txt' });

  if (!result.canceled) {
    // Écrit le contenu vide dans le fichier choisi par l'utilisateur
    fs.writeFileSync(result.filePath, content); 

    // Affiche une notification système native
    new Notification({
      title: 'Nouveau fichier',
      body:  'Fichier créé avec succès.'
    }).show();

    // Optionnel mais très recommandé : on envoie le contenu vide au renderer
    // pour qu'il efface l'éditeur de texte de l'application
    if (mainWindow) {
        mainWindow.webContents.send('file-opened', { content, filePath: result.filePath });
    }

    return result.filePath; // Retourné au renderer si appelé via IPC
  }

  return null; // L'utilisateur a annulé → on retourne null
}

// Enregistre un gestionnaire IPC pour répondre au renderer quand il appelle l'API "nouveau"
ipcMain.handle('new-file-dialog', () => newFileDialog());
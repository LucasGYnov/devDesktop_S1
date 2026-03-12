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
const {
  app,           
  BrowserWindow, 
  ipcMain,       
  dialog,        
  Menu,          
  Tray,          
  Notification,  
  nativeImage    
} = require('electron');

const path  = require('node:path');   
const fs    = require('node:fs');     
const Store = require('electron-store'); 



// ─── 2. STOCKAGE LOCAL ──────────────────────────────────────
const store = new Store();


// ─── 3. VARIABLES GLOBALES ──────────────────────────────────
let mainWindow; 
let tray;       
let currentFilePath = null; // <-- Mémorise le chemin du fichier en cours


// ─── 4. CRÉATION DE LA FENÊTRE ──────────────────────────────
function createWindow() {

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, 
      nodeIntegration: false, 
    }
  });

  mainWindow.loadFile('index.html');
  createMenu();

  mainWindow.on('close', (event) => {
    event.preventDefault(); 
    mainWindow.hide();      
  });
}


// ─── 5. SYSTEM TRAY (icône barre des tâches) ────────────────
function createTray() {

  const iconPath = path.join(__dirname, 'icon.png');

  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath) 
    : nativeImage.createEmpty();           

  tray = new Tray(icon);
  tray.setToolTip('Mon App Electron');

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Afficher',
      click: () => mainWindow.show() 
    },
    {
      label: 'Quitter',
      click: () => {
        mainWindow.removeAllListeners('close');
        app.quit(); 
      }
    }
  ]));

  tray.on('double-click', () => mainWindow.show());
}


// ─── 6. MENU NATIF ──────────────────────────────────────────
function createMenu() {

  const menu = Menu.buildFromTemplate([
    {
      label: 'Fichier',     
      submenu: [
        {
          label: 'Nouveau',
          accelerator: 'CmdOrCtrl+N', 
          click: () => { void newFileDialog(); }
        },
        {
          label: 'Ouvrir',
          accelerator: 'CmdOrCtrl+O', 
          click: () => { void openFileDialog(); }
        },
        {
          label: 'Sauvegarder',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save')
        },
        { type: 'separator' }, 
        { label: 'Quitter', role: 'quit' } 
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo'  }, 
        { role: 'redo'  }, 
        { type: 'separator' },
        { role: 'cut'   }, 
        { role: 'copy'  }, 
        { role: 'paste' }  
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
}


// ─── 7. OUVRIR UN FICHIER ───────────────────────────────────
async function openFileDialog() {

  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Texte', extensions: ['txt'] }], // Seulement les extnesion txt
    properties: ['openFile'] 
  });

  if (!result.canceled) {
    currentFilePath = result.filePaths[0];
    const content = fs.readFileSync(currentFilePath, 'utf-8'); // seul moyen que j'ai trouvé  pour le .txt

    mainWindow.webContents.send('file-opened', { content, filePath: currentFilePath });
    return currentFilePath; 
  }

  const filePath = result.filePaths ? result.filePaths[0] : null;
  const fileName = filePath ? path.basename(filePath) : 'Aucun fichier';
  mainWindow.webContents.send('file-opened', { content: '', filePath: fileName });

  return null; 
}

ipcMain.handle('open-file-dialog', () => openFileDialog());


// ─── 8. SAUVEGARDER UN FICHIER ──────────────────────────────
ipcMain.handle('save-content', async (event, content) => {

  // Si un fichier est DÉJÀ ouvert ou a déjà été créé, on sauvegarde directement dedans
  if (currentFilePath) {
    fs.writeFileSync(currentFilePath, content);
    
    new Notification({
      title: 'Sauvegardé',
      body: 'Le fichier a été mis à jour.'
    }).show();
    
    return currentFilePath;
  } 
  // Sinon (aucun fichier courant), on fait un "Enregistrer sous..."
  else {
    const result = await dialog.showSaveDialog({ 
      filters: [{ name: 'Texte', extensions: ['txt'] }], // Force le format .txt
      defaultPath: 'nouveau_document.txt' 
    });

    if (!result.canceled) {
      currentFilePath = result.filePath; // On mémorise le nouveau fichier
      fs.writeFileSync(currentFilePath, content);

      new Notification({
        title: 'Terminé',          
        body:  'Nouveau fichier sauvegardé.' 
      }).show(); 

      // On met à jour le renderer pour qu'il connaisse le nouveau chemin
      mainWindow.webContents.send('file-opened', { content, filePath: currentFilePath });
      
      return currentFilePath;
    }
  }
});


// ─── 9. STOCKAGE LOCAL — GESTIONNAIRES IPC ──────────────────
ipcMain.handle('store-get',    (_e, key, def)   => store.get(key, def));
ipcMain.handle('store-set',    (_e, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (_e, key)        => store.delete(key));


// ─── 10. DÉMARRAGE DE L'APPLICATION ─────────────────────────
app.whenReady().then(() => {
  createWindow(); 
  createTray();   
});


// ─── 11. CRÉER UN NOUVEAU FICHIER ───────────────────────────
async function newFileDialog() {
  const content = ''; 

  const result = await dialog.showSaveDialog({ 
    filters: [{ name: 'Texte', extensions: ['txt'] }], 
    defaultPath: 'nouveau.txt' 
  });

  if (!result.canceled) {
    currentFilePath = result.filePath; 
    // Écrit le contenu vide dans le fichier
    fs.writeFileSync(currentFilePath, content); 

    new Notification({
      title: 'Nouveau fichier',
      body:  'Fichier créé et ouvert avec succès.'
    }).show();

    // On envoie le fichier vide à l'interface pour réinitialiser l'éditeur
    if (mainWindow) {
        mainWindow.webContents.send('file-opened', { content, filePath: currentFilePath });
    }
    return currentFilePath; 
  }
  return null; 
}

ipcMain.handle('new-file-dialog', () => newFileDialog());



store.set('preferences.theme', 'dark'); // Sauvegarder
const theme = store.get('preferences.theme', 'light'); // Lire (+ valeur par défaut)
store.delete('preferences.theme'); 
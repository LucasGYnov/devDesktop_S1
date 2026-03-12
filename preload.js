// ============================================================
// preload.js — Script "pont" entre le Main et le Renderer
// ============================================================
//
// POURQUOI CE FICHIER EXISTE-T-IL ?
//
// Par sécurité, Electron interdit au renderer (la page web) d'accéder
// directement à Node.js. Si une page malveillante était chargée,
// elle ne pourrait pas lire vos fichiers ou exécuter du code système.
//
// Mais notre application A besoin de communiquer avec le système.
// C'est le rôle du preload : il s'exécute dans un contexte privilégié
// qui a accès À LA FOIS à Node.js ET au DOM de la page.
//
// PRINCIPE DE FONCTIONNEMENT :
//
//   Main (Node.js)
//      ↕  IPC
//   Preload (pont sécurisé)  ← CE FICHIER
//      ↕  window.api
//   Renderer (page web)
//
// Ce fichier définit EXACTEMENT quelles fonctions le renderer peut utiliser.
// Rien de plus, rien de moins → principe du "moindre privilège".
// ============================================================


// contextBridge : outil Electron pour exposer des fonctions au renderer en toute sécurité
// ipcRenderer   : permet d'envoyer des messages au processus main et d'en recevoir
const { contextBridge, ipcRenderer } = require('electron');


// ─── EXPOSITION DE L'API ─────────────────────────────────────
// contextBridge.exposeInMainWorld('api', { ... })
// → Crée un objet accessible dans la page via window.api (ou globalThis.api)
// → Le renderer ne voit QUE cet objet, pas ipcRenderer lui-même (sécurité)

contextBridge.exposeInMainWorld('api', {

  // ── OUVRIR UN FICHIER ──────────────────────────────────────
  // Le renderer appelle : await globalThis.api.ouvrir()
  // → Cela déclenche dans le main : ipcMain.handle('open-file-dialog', ...)
  // → Retourne le chemin du fichier choisi, ou null si annulé
  // Direction du message : Renderer → Main (requête/réponse = invoke/handle)
  ouvrir: () => ipcRenderer.invoke('open-file-dialog'),


  // ── SAUVEGARDER UN FICHIER ─────────────────────────────────
  // Le renderer appelle : await globalThis.api.sauvegarder(texte)
  // → Envoie le contenu texte au main qui l'écrit sur le disque
  // → Retourne une promesse résolue quand la sauvegarde est terminée
  // Direction : Renderer → Main
  sauvegarder: (content) => ipcRenderer.invoke('save-content', content),

  // Nouveau : créer un nouveau fichier (boîte "Enregistrer sous")
  nouveau: () => ipcRenderer.invoke('new-file-dialog'),
  


  // ── RECEVOIR UN FICHIER OUVERT (depuis le menu natif) ──────
  // Le renderer appelle : globalThis.api.onFileOpened(callback)
  // → Enregistre une fonction (callback) à appeler quand le main envoie 'file-opened'
  // → Le callback reçoit l'objet : { content: string, filePath: string }
  //
  // Exemple d'utilisation dans renderer.js :
  //   globalThis.api.onFileOpened(({ content, filePath }) => {
  //     editor.value = content;
  //   });
  //
  // Direction : Main → Renderer (le main "pousse" les données au renderer)
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (_event, data) => cb(data)),
  // Note : on ignore '_event' (premier arg) car on n'en a pas besoin


  // ── RECEVOIR LE SIGNAL "SAUVEGARDER" (depuis le menu Ctrl+S) ──
  // Le renderer appelle : globalThis.api.onMenuSave(callback)
  // → Le main ne peut pas accéder au texte de l'éditeur directement.
  //   Il envoie donc juste un signal au renderer pour lui dire :
  //   "l'utilisateur veut sauvegarder, récupère le texte et envoie-le moi"
  // Direction : Main → Renderer
  onMenuSave: (cb) => ipcRenderer.on('menu-save', () => cb()),


  // ── STOCKAGE LOCAL — LIRE UNE PRÉFÉRENCE ───────────────────
  // Le renderer appelle : await globalThis.api.getPreference('preferences.theme', 'dark')
  // → Lit la valeur de la clé dans le fichier JSON géré par electron-store
  // → 2ème argument = valeur par défaut si la clé n'existe pas encore
  // Direction : Renderer → Main
  getPreference: (key, defaultValue) => ipcRenderer.invoke('store-get', key, defaultValue),


  // ── STOCKAGE LOCAL — ÉCRIRE UNE PRÉFÉRENCE ─────────────────
  // Le renderer appelle : await globalThis.api.setPreference('preferences.theme', 'light')
  // → Écrit (ou met à jour) la valeur dans le fichier JSON de préférences
  // Direction : Renderer → Main
  setPreference: (key, value) => ipcRenderer.invoke('store-set', key, value),


  // ── STOCKAGE LOCAL — SUPPRIMER UNE PRÉFÉRENCE ──────────────
  // Le renderer appelle : await globalThis.api.deletePreference('preferences.theme')
  // → Supprime la clé du fichier JSON de préférences
  // Direction : Renderer → Main
  deletePreference: (key) => ipcRenderer.invoke('store-delete', key)

});

// ============================================================
// renderer.js — Processus RENDERER (interface utilisateur)
// ============================================================
//
// Ce fichier s'exécute dans la fenêtre Electron, exactement comme
// du JavaScript dans un navigateur web classique.
//
// RÈGLE IMPORTANTE :
//   Ce fichier N'A PAS accès à Node.js ni aux modules Electron.
//   Pour interagir avec le système (fichiers, dialogues, stockage…),
//   il doit TOUJOURS passer par globalThis.api, l'objet exposé
//   par preload.js via contextBridge.
//
// CHARGÉ EN TANT QUE MODULE ES (<script type="module" dans index.html)
//   Cela permet d'utiliser "await" directement au niveau supérieur
//   du fichier (top-level await), sans avoir besoin d'une fonction async.
// ============================================================


// ─── 1. RÉFÉRENCES AUX ÉLÉMENTS DE LA PAGE ──────────────────
// On récupère les éléments HTML une seule fois et on les stocke
// dans des variables pour ne pas avoir à les chercher à chaque fois.
const editor    = document.getElementById('editor');    // La zone de texte principale
const filepath  = document.getElementById('filepath');  // L'affichage du chemin en haut
const statusbar = document.getElementById('statusbar'); // La barre de statut en bas


// ─── 2. THÈME CLAIR / SOMBRE (electron-store) ───────────────
// Au démarrage, on demande au main de lire la préférence de thème
// sauvegardée lors de la session précédente.
//
// "top-level await" : on peut utiliser await ici sans encapsuler dans async
// car le fichier est chargé comme un module ES (type="module").
//
// getPreference('preferences.theme', 'dark') :
//   → 1er arg : la clé dans le fichier JSON de préférences
//   → 2ème arg : valeur par défaut si la clé n'a jamais été définie
const theme = await globalThis.api.getPreference('preferences.theme', 'dark');

// On applique le thème au <body> via un attribut data-theme.
// Le CSS surveille cet attribut pour changer les couleurs :
//   body[data-theme="light"] { background: #F0F2F5; ... }
//   body[data-theme="dark"]  { background: #1E2A3A; ... }  (valeur par défaut du CSS)
document.body.dataset.theme = theme;


// ─── 3. BOUTON "THÈME" ──────────────────────────────────────
// Bascule entre le thème sombre (dark) et le thème clair (light).
document.getElementById('btn-theme').addEventListener('click', async () => {

  // Lit le thème actuellement appliqué sur le <body>
  const current = document.body.dataset.theme || 'dark';

  // Bascule vers l'autre thème (opérateur ternaire : condition ? siVrai : siFaux)
  const next = current === 'dark' ? 'light' : 'dark';

  // Applique immédiatement le nouveau thème visuellement
  document.body.dataset.theme = next;

  // Sauvegarde le choix dans les préférences (persistant entre sessions)
  await globalThis.api.setPreference('preferences.theme', next);

  // Informe l'utilisateur dans la barre de statut
  statusbar.textContent = `Thème ${next} activé`;
});


// ─── 4. BOUTON "OUVRIR" ─────────────────────────────────────
// Quand l'utilisateur clique sur "Ouvrir" :
//   1. On demande au main d'afficher la boîte de dialogue "Ouvrir un fichier"
//   2. Le main lit le fichier et envoie son contenu via l'événement 'file-opened'
//      (géré par onFileOpened plus bas)
//   3. Ici on récupère juste le chemin pour l'afficher dans l'interface
document.getElementById('btn-open')
  .addEventListener('click', async () => {

    // invoke → envoie une requête au main et attend sa réponse (promesse)
    // Retourne le chemin du fichier, ou null si l'utilisateur a annulé
    const chemin = await globalThis.api.ouvrir();

    if (chemin) {
      // Affiche le chemin du fichier dans le header
      filepath.textContent  = chemin;
      statusbar.textContent = `Fichier ouvert : ${chemin}`;
    }
    // Si chemin === null, l'utilisateur a annulé → on ne fait rien
  });


// ─── 5. BOUTON "SAUVEGARDER" ────────────────────────────────
// Quand l'utilisateur clique sur "Sauvegarder" :
//   1. On récupère le texte dans l'éditeur
//   2. On envoie ce texte au main via IPC
//   3. Le main affiche la boîte "Enregistrer sous" et écrit le fichier
//   4. Une notification système s'affiche quand c'est terminé
document.getElementById('btn-save')
  .addEventListener('click', async () => {

    const contenu = editor.value;

    // Sécurité : on empêche de sauvegarder si l'éditeur est vide
    // .trim() supprime les espaces/retours à la ligne avant de vérifier
    if (!contenu.trim()) {
      statusbar.textContent = '⚠️ Rien à sauvegarder.';
      return; // Arrête la fonction ici
    }

    // Envoie le contenu au main et attend la fin de la sauvegarde
    await globalThis.api.sauvegarder(contenu);
    statusbar.textContent = 'Fichier sauvegardé ✔';
  });


// ─── 6. BOUTON "EFFACER" ────────────────────────────────────
// Vide l'éditeur et réinitialise l'affichage.
// Aucun IPC nécessaire : tout se passe dans la page, pas de fichier touché.
document.getElementById('btn-clear')
  .addEventListener('click', () => {
    editor.value          = '';
    filepath.textContent  = 'Aucun fichier ouvert';
    statusbar.textContent = 'Éditeur effacé';
  });


// ─── 7. RÉCEPTION D'UN FICHIER OUVERT (depuis le menu natif) ─
// Quand l'utilisateur passe par le menu Fichier > Ouvrir (ou Ctrl+O),
// c'est le main qui déclenche l'ouverture du fichier directement.
// Le main lit le fichier et "pousse" son contenu ici via l'événement 'file-opened'.
//
// onFileOpened(callback) enregistre une fonction qui sera appelée
// AUTOMATIQUEMENT à chaque fois que le main envoie cet événement.
// La fonction reçoit un objet : { content, filePath }
globalThis.api.onFileOpened(({ content, filePath }) => {
  editor.value          = content;   // Met le texte du fichier dans l'éditeur
  filepath.textContent  = filePath;  // Affiche le chemin du fichier
  statusbar.textContent = 'Fichier chargé ✔';
});


// ─── 8. SAUVEGARDE DÉCLENCHÉE PAR LE MENU (Ctrl+S) ──────────
// Quand l'utilisateur appuie sur Ctrl+S ou Fichier > Sauvegarder,
// le main ne peut pas récupérer le texte de l'éditeur directement
// (il n'a pas accès au DOM de la page).
//
// Donc le main envoie un signal 'menu-save' au renderer,
// qui lit lui-même le texte et le renvoie au main pour sauvegarde.
// C'est un "aller-retour" nécessaire à cause de l'isolation des processus.
globalThis.api.onMenuSave(async () => {
  const contenu = editor.value;

  if (!contenu.trim()) {
    statusbar.textContent = '⚠️ Rien à sauvegarder.';
    return;
  }

  await globalThis.api.sauvegarder(contenu);
  statusbar.textContent = 'Fichier sauvegardé ✔';
});


// ─── 9. COMPTEUR DE CARACTÈRES ──────────────────────────────
// L'événement 'input' se déclenche à chaque frappe dans le textarea.
// On compte les caractères et on met à jour la barre de statut en temps réel.
editor.addEventListener('input', () => {
  const n = editor.value.length;
  // Gestion du singulier/pluriel : "1 caractère" vs "2 caractères"
  statusbar.textContent = `${n} caractère${n > 1 ? 's' : ''}`;
});

// ─── 10. BOUTON "NOUVEAU" (DIALOGUE DE SAUVEGARDE) ─────────
document.getElementById('btn-new')
    .addEventListener('click', async () => {

    const chemin = await globalThis.api.nouveau();
  });


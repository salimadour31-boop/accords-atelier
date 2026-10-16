# Accords Atelier

**Construisez, écoutez et exportez des progressions d'accords, directement dans le navigateur — et, depuis la v2, harmonisez votre propre mélodie ou générez-en une, puis mixez le tout dans un studio multipiste.**
Outil gratuit et open source pour musiciens, compositeurs de musique de film et monteurs vidéo. Interface en français, anglais et taqbaylit (kabyle).

🎹 **Démo : https://salimadour31-boop.github.io/accords-atelier/**

![Aperçu bureau](screenshot.png)

## Fonctionnalités

- 12 tonalités et 9 modes : majeur, dorien, phrygien, lydien, mixolydien, mineur naturel, locrien, mineur harmonique, mineur mélodique.
- Accords de la gamme en triades ou en septièmes, avec chiffrage romain (I, ii, ♭VII…) et fonction harmonique.
- Progressions célèbres en un clic : pop, années 50, jazz ii–V–I, Canon, cadence andalouse, épique/cinéma, tension sombre, blues 12 mesures.
- Lecture avec synthé intégré (nappe douce, clavier, pincé), tempo réglable, mode arpège et boucle.
- Clavier de deux octaves qui montre les notes de l'accord joué.
- Transposition d'un demi-ton vers le haut ou le bas.
- Export **MIDI** (à glisser dans un DAW ou un logiciel de montage) et export **texte**.
- Lien partageable : la progression est enregistrée dans l'adresse de la page.

## Nouveautés v2 : mélodie & studio multipiste

- **Import de mélodie MIDI** (.mid, format 0/1, lu par un parseur JavaScript maison) : choix de la piste, détection de la **tonalité et du mode** (profils de Krumhansl-Kessler + profils modaux), puis **harmonisation automatique** : un accord par segment, choisi par programmation dynamique (notes de la mélodie sur les temps forts + enchaînements usuels ii–V–I, IV–I…).
- **Import audio** (WAV/MP3/OGG via `decodeAudioData`) : détection de hauteur **YIN**, transcription en notes, estimation de la tonalité, **BPM automatique** (autocorrélation des attaques) ou **tap tempo**, et décalage du temps 1 pour caler les accords sur la mélodie.
- **Générateur de mélodie** : notes de l'accord sur les temps forts, notes de passage sur les temps faibles, motif rythmique répété, cadence finale ; styles *lyrique / pop / arpèges*, densité, tessiture, **graine** pour un résultat reproductible. Bouton **Variation** pour décliner une mélodie importée ou générée.
- **Studio multipiste** : pistes **Mélodie** (audio importé, MIDI importé ou généré), **Accords** (plaqués/arpégés), **Basse** (générée depuis les accords : fondamentales, croches, walking, octaves) et **Batterie** (motifs synthétisés pop, rock, hip-hop, demi-tempo, four on the floor). Par piste : volume, pan, muet, solo, instrument, filtre passe-bas, départs réverb et écho.
- **Bus master** avec limiteur et vumètre, **transport** (lecture, stop, boucle, BPM, métronome), **timeline** par mesures avec une lane par piste et tête de lecture.
- **Exports** : mixage **WAV** (rendu `OfflineAudioContext`), **pistes séparées** WAV (stems), **MIDI multipiste** (format 1 : mélodie, accords, basse, batterie canal 10) et **projet JSON** (réouvrable).

## Utilisation

1. Ouvrez la [démo](https://salimadour31-boop.github.io/accords-atelier/) (ou `index.html` en local, aucune installation).
2. Choisissez la tonalité, le mode et le type d'accord.
3. Cliquez sur les accords pour les ajouter à la progression, ou chargez une progression célèbre.
4. Appuyez sur **▶ Lire**, puis exportez en MIDI ou copiez le lien.
5. *Studio* : importez votre mélodie (MIDI ou audio) et cliquez sur **Harmoniser la mélodie**, ou cliquez sur **Générer une mélodie** pour en créer une sur votre progression.
6. Réglez le mixage piste par piste dans **Studio multipiste**, écoutez en boucle, puis exportez le mixage WAV, les stems, le MIDI multipiste ou le projet JSON.

### Limites connues

- La détection de hauteur audio est conçue pour des **mélodies monophoniques** (voix seule, instrument solo) ; un mix complet ou des accords donneront des notes approximatives. L'analyse porte sur les 90 premières secondes.
- L'audio importé n'est pas étiré quand on change le tempo (pas de time-stretch) : réglez le BPM sur celui de l'enregistrement.
- Le fichier audio n'est pas stocké dans le projet JSON (seules les notes détectées le sont).
- Les fichiers MIDI à base de temps SMPTE ne sont pas pris en charge ; la mesure est supposée en 4/4.

## English

Free browser tool to build chord progressions in any key and mode, hear them with a built-in synth, see the notes on a keyboard, transpose, and export to MIDI or text. **v2** adds melody import (MIDI parser, audio pitch detection with YIN, key/mode detection, automatic harmonisation), a seeded melody generator with variations, and a multitrack studio (melody, chords, bass, drums; volume/pan/mute/solo, instruments, filter, reverb/delay sends, master limiter, metronome, timeline) with WAV mixdown, WAV stems, multitrack MIDI and project JSON export. No install, no data sent anywhere.

## Version mobile

![Aperçu mobile](screenshot-mobile.png)

## Technique

HTML, CSS et JavaScript sans dépendance. Le son est généré avec la Web Audio API ; les fichiers MIDI et WAV sont écrits dans le navigateur. Fichiers : `index.html`, `styles.css`, `theory.js` (théorie musicale), `i18n.js` (traductions FR/EN/Taqbaylit), `app.js` (progression, audio, export), `core.js` (noyau sans DOM : parseur/écrivain MIDI, tonalité, harmonisation, générateur, YIN, BPM, WAV), `studio.js` (studio multipiste, mixage, exports).

### Tests

```bash
node tests/core.test.js                      # tests unitaires (parseur MIDI, tonalité, harmonisation, génération, YIN, WAV)
python3 -m http.server 8765 &                 # puis, avec puppeteer-core installé :
NODE_PATH=/chemin/vers/node_modules node tests/e2e.js   # Chrome headless, bureau + mobile, exports MIDI/WAV vérifiés
```

## Licence

[MIT](LICENSE)

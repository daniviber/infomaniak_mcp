# Contribution

Chaque lot possède un contrat, une branche `feat/NN` ou `fix/NN` issue de
`integration` et son propre worktree. Outcome, Touches, Constraints et Verification
fixent la contribution ; toute question non tranchée se remonte avant modification.
Ne pas modifier les points d’entrée, dépendances ou fichiers voisins hors contrat.
Committer sur la branche du lot, sans force-push, et arrêter dès la condition de fin
satisfaite. Trois échecs consécutifs du même test imposent un arrêt et un rapport.

## Environnement

Référence : Node 20.19.2, npm 9.2.0, Git et shell POSIX. Conserver le lockfile v3.
`npm ci` installe uniquement les dépendances déjà verrouillées. Un runtime absent du
PATH, un besoin root ou de gestionnaire de paquets système se rapporte à l’opérateur :
aucune installation système, binaire vendored ou shim de substitution.

## Vérification composée

Depuis le worktree du lot, exécuter dans cet ordre :

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm exec -- vitest run test/acceptance/mvp-demo.test.ts
node scripts/verify-mvp.mjs
npm run build
npm audit --audit-level=high
```

Tous les codes doivent être 0, lint/format sans écart, suite complète et scénario
Vitest verts, `MVP OFFLINE PASS` et `orphan tools: 0`, build vert et zéro vulnérabilité
haute/critique. `npm run verify:mvp` est le raccourci autonome du script ; il construit
ses imports même si aucun build n’existe. Il ne remplace pas lint, format, la suite
complète ou l’audit de cette procédure.

Le périmètre de `format:check` est celui de `.prettierignore`. Formater explicitement
les nouveaux scripts et documents du lot s’ils en sont exclus. `typecheck` suit le
tsconfig existant ; Vitest exécute les tests hors de son périmètre.

C3 impose des tokens sentinelles et des doubles, sans aucun socket fournisseur.
L’écoute loopback des tests HTTP est admise, le registry sert uniquement à
l’installation et à l’audit. Aucune attente réelle à délai littéral dans les tests :
employer horloges injectées, fake timers ou synchronisation par événements.
L’Inspector et les comptes fournisseur ne font pas partie de cette acceptation.

## Contrats et preuves

Les définitions sous `src/features/` exportent leurs outils et leurs handlers ; la
composition rejette doublons et handlers manquants. Les schémas d’entrée/sortie, la
classe, l’idempotence et les limites sont déclarés explicitement. Respecter les
frontières domaine → application → adaptateurs → composition, et le test
architectural existant.

Conserver `product/inventory/tools.json` et `test/fixtures/baseline-tools.json` en
tableaux de premier niveau, avec `name` dans chaque entrée. Enrichir l’entrée de
l’inventaire, jamais son enveloppe. Les noms doivent correspondre aux déclarations
et au registre complet, indépendamment des indicateurs de visibilité.

Les tests d’un lot comparent des ensembles ou des mesures entre elles ; ils ne
figent pas les totaux globaux du dépôt, même via un ternaire. Les totaux absolus
appartiennent à la vérification composée et au script FEAT-12. Les preuves
`official`/`baseline`/`unproven` restent distinctes de la preuve fournisseur : les
cycles sur doubles sont « non prouvés côté fournisseur ».

Le rapport de livraison fournit SHA des commits et parents, `git status --porcelain`
avant/après, neuf commandes et codes de sortie, mesures d’invariants et limites de
preuve. Il doit être confirmé indépendamment par reviewer et verif sur le SHA livré.
Aucune publication, release ou déploiement n’est implicite.

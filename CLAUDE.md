# Guide du dépôt après refonte

Lire le contrat du lot avant d’agir ; il est la frontière de modification. Les
instructions de contribution sont dans `CONTRIBUTING.md`. Le rapport historique
`SECURITY_AUDIT.md` est conservé ; son addendum « état après refonte » décrit la cible
actuelle et ses limites de preuve.

## Architecture actuelle

- `src/domain/` : modèles validés Zod et `ToolContract` ; classe, idempotence,
  expérimental, raw, schémas et limites explicites.
- `src/application/` : ports, cas d’usage, bindings, politique et `FeatureModule`.
  La politique précède validation d’entrée et invocation fournisseur.
- `src/adapters/outbound/` : passerelle partagée, DTO et projections domaine,
  adaptateurs Infomaniak et kChat. Les URL ne sont pas assemblées dans le domaine.
- `src/adapters/inbound/` : SDK MCP v2, stdio moderne/legacy, handlers HTTP,
  admission bearer/Host/Origin et borne de corps.
- `src/config/runtime-config.ts` : configuration validée et capturée au démarrage.
- `src/features/*.feature.ts` : modules déclaratifs exportant `tools`,
  `createHandlers` et éventuellement `selectTools`.
- `src/main/bootstrap.ts` : découverte, composition, injection des gateways,
  du fetch borné et de l’horloge, bucket partagé entre produits et tokens.
- `src/main/stdio.ts` : exécutable moderne à effets de bord, aucun export.
  Importer `startModernStdio` pour un test, jamais cet exécutable.
- `src/main/http.ts`, `src/main/legacy.ts` : applications testables et entrées
  explicites, sans sélecteur `MCP_TRANSPORT`.

Node de référence 20.19.2, npm 9.2.0 ; TypeScript ES2022/Node16 ESM, Zod 4,
Express 5 et paquets MCP `core`, `server`, `node`, `client` v2. `npm run build`
utilise `tsc -p tsconfig.build.json`. Les chemins main/bin/start/inspector sont
ceux de `package.json`, conservés et vérifiés par `test/transports/stdio-2026.test.ts`.

## Politique et sorties

Les indicateurs expérimental et raw gouvernent visibilité **et appelabilité**.
L’outil raw exige les deux ; kChat exige hôte et token. `readOnly` conserve le
catalogue et refuse writes/destructives ; pour raw il limite la méthode à GET.
Les classifications sont déclarées, jamais déduites des préfixes de noms.

Refus figé : `[POLICY_DENIED] <reason>: <toolName>` et son `structuredContent`
d’erreur. Succès : JSON indenté de 2 espaces identique à `structuredContent`.
Les DTO sont validés puis projetés en modèles de domaine. Seul raw retourne
`{ method, endpoint, status, data }`, avec `data` validé uniquement comme JSON.

Ne pas ouvrir les unions de droits, corriger les routes Swiss Backup ou masquer
la divergence kChat GET → POST : leurs limites et preuves sont consignées dans
`product/inventory/tools.json` et le README. Toute correction nécessite son cadrage.

## Transports et vérification

MCP 2026-07-28 sur stdio et HTTP est la cible ; 2025-11-25 reste accessible via
`build/main/legacy.js` (option `--http` pour HTTP) jusqu’au gate FEAT-13. HTTP est
sans session, POST `/mcp`, sans reprise SSE. OAuth/OIDC et capacités MCP hors outils
sont exclus. Ne pas réintroduire d’options de session ou d’ancien SDK v1.

`npm run verify:mvp` construit puis vérifie inventaire et scénario hors ligne sur
les vrais transports SDK, avec tokens sentinelles, fetchs doubles et sockets
loopback uniquement. Le script ne lit pas de token opérateur. Les cycles kDrive et
Calendar DST restent « non prouvés côté fournisseur » ; nettoyage sans objet sous
C3. La suite complète et l’audit restent exigés séparément par CONTRIBUTING.

Les tests d’un lot ne figent aucun compte global. Les totaux sont recalculés dans
le script composé FEAT-12. Les inventaires restent des tableaux JSON d’entrées
nommées, avec le même jeu de noms que le registre complet. Ne pas confondre
couverture de liaison et succès d’une opération sur le backend fournisseur.

# Infomaniak MCP Server

Serveur TypeScript composé de contrats d’outils, de modèles de domaine validés et
d’adaptateurs Infomaniak. La cible admise est MCP **2026-07-28**, SDK v2, stdio ou
HTTP sans session. La compatibilité **2025-11-25** reste explicite jusqu’au gate FEAT-13.
OAuth/OIDC et les capacités MCP autres que les outils (resources, prompts, sampling,
elicitation, tasks, subscriptions) sont hors cible.

## Installation et lancement

Référence vérifiée : Node **20.19.2**, npm **9.2.0**, Git, shell POSIX.
Le lockfile v3 fait autorité ; aucune installation système n’est requise.

```sh
npm ci
npm run build
# Après configuration des variables d’environnement par le client ou le shell :
npm start
```

`npm start`, `main` et le binaire `infomaniak-mcp-server` désignent
`build/main/stdio.js`. `npm run inspector` reste
`npx @modelcontextprotocol/inspector build/main/stdio.js` ; il ne fait pas partie de
l’acceptation hors ligne. `.env.example` décrit les variables ; le serveur ne charge
pas automatiquement un fichier `.env`.

| Protocole                | Transport | Commande                           |
| ------------------------ | --------- | ---------------------------------- |
| 2026-07-28               | stdio     | `node build/main/stdio.js`         |
| 2026-07-28               | HTTP      | `node build/main/http.js`          |
| 2025-11-25               | stdio     | `node build/main/legacy.js`        |
| 2025-11-25 et 2026-07-28 | HTTP      | `node build/main/legacy.js --http` |

HTTP reçoit `POST /mcp`, avec `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>` et les
métadonnées du protocole négocié. Il n’expose ni sessions, ni reprise par
`Last-Event-ID`, ni écoute GET/SSE. L’admission contrôle bearer, Host et Origin avant
le corps et la construction MCP. Le serveur moderne refuse les requêtes legacy ;
l’entrée legacy HTTP dirige chaque requête vers l’ère SDK correspondante. Les
clients SDK isolent leurs échanges ; le registre et la configuration sont partagés,
avec une nouvelle instance serveur par requête HTTP.

## Catalogue et politique

L’[inventaire](product/inventory/tools.json) contient **111 définitions uniques**,
indépendamment de leur visibilité. La [baseline](test/fixtures/baseline-tools.json)
conserve le même jeu de noms. Les deux fichiers sont des tableaux JSON de premier
niveau, jamais des objets enveloppes. Le script d’acceptation contrôle séparément
la composition des **9 modules**, les handlers, les schémas et la visibilité.

Le catalogue par défaut contient **62 outils** : comptes/profil, DNS, kDrive,
Calendar, hébergement web, bases, Swiss Backup, certificats, liste des factures et
mise à jour des serveurs de noms. Cron, FTP, fiche de facture et lecture des
serveurs de noms sont désormais expérimentaux faute de route établie.
Les outils expérimentaux couvrent notamment mail administratif, domaines par compte,
VPS, serveurs dédiés et API brute. kChat nécessite `KCHAT_HOST` **et** `KCHAT_TOKEN`.
Avec les deux indicateurs et kChat configuré, le catalogue contient **111 outils**.

- `INFOMANIAK_ALLOW_EXPERIMENTAL` autorise visibilité **et appelabilité** des
  outils expérimentaux.
- `INFOMANIAK_ALLOW_RAW_API` est également nécessaire à `infomaniak_api_call` :
  **les deux indicateurs** doivent être vrais.
- `INFOMANIAK_READ_ONLY` ne masque aucun outil. Il refuse les appels d’écriture
  et destructifs ; pour l’API brute, il gouverne la méthode et n’autorise que GET.
  Les recherches kChat en POST restent des opérations de lecture classées par contrat.

Un refus conserve exactement `[POLICY_DENIED] <reason>: <toolName>` et
`structuredContent: { error: { code: "POLICY_DENIED", reason, tool } }`, avec
`isError: true`. Il précède l’appel fournisseur. Les classifications et annotations
proviennent des contrats, pas d’une inférence à partir du nom.

Le texte d’un succès est le JSON indenté de **2 espaces**, identique au contenu
structuré domaine. Les DTO sont validés puis projetés ; les champs fournisseur
inconnus ne deviennent pas automatiquement des sorties. **Exception unique :**
`infomaniak_api_call` retourne `{ method, endpoint, status, data }`, où `data` est
validé uniquement comme JSON, sans modèle de domaine.

## Configuration et limites

| Variable                                                    | Défaut / effet                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `INFOMANIAK_API_TOKEN`                                      | Obligatoire ; token principal                                        |
| `INFOMANIAK_CALENDAR_TOKEN`                                 | Si absent, réutilise le principal ; token du propriétaire de mailbox |
| `KCHAT_HOST`, `KCHAT_TOKEN`                                 | Paire optionnelle ; hôte nu, sans schéma ni chemin                   |
| `INFOMANIAK_READ_ONLY`                                      | `false`                                                              |
| `INFOMANIAK_ALLOW_EXPERIMENTAL`, `INFOMANIAK_ALLOW_RAW_API` | `false`                                                              |
| `INFOMANIAK_TIMEOUT_MS`                                     | `30000`, entier positif                                              |
| `MCP_TOOLS_TTL_MS`                                          | `60000`, entier ≥ 0 ; cache privé tools/list                         |
| `KDRIVE_MAX_DOWNLOAD_BYTES`                                 | `10485760` (10 Mio)                                                  |
| `KDRIVE_MAX_UPLOAD_BYTES`                                   | `52428800` (50 Mio)                                                  |
| `MCP_HTTP_BODY_LIMIT`                                       | `20971520` (20 Mio), minimum 65536 ; unités b/kb/mb/gb admises       |
| `MCP_HOST`                                                  | `127.0.0.1`                                                          |
| `MCP_PORT`                                                  | `3000` ; `PORT` sert de repli si MCP_PORT est absent                 |
| `MCP_HTTP_AUTH_TOKEN`                                       | ≥16 caractères ; obligatoire sauf dérogation loopback explicite      |
| `MCP_HTTP_ALLOW_UNAUTHENTICATED`                            | `false` ; `true` seulement avec bind loopback                        |
| `MCP_ALLOWED_HOSTS`                                         | `localhost,127.0.0.1,[::1]`                                          |
| `MCP_CORS_ORIGINS`                                          | Liste vide ; origines explicites séparées par virgule                |

Les booléens acceptent `true/false`, `1/0`, `yes/no`, `on/off`. Une variable
optionnelle vide n’équivaut pas en général à son absence ; laisser Calendar et kChat
non définis s’ils sont inutilisés. Aucun switch `MCP_TRANSPORT`, `MCP_STATELESS`,
de session ou `INFOMANIAK_DISABLE_CALENDAR` n’est pris en charge.

Les limites de transfert/HTTP sont configurables. L’admission des arguments JSON
UTF-8 d’un upload vaut `min(uploadLimit, bodyLimit - 65536)` ; les octets décodés
sont aussi bornés et le base64 augmente la taille des arguments. Les limites affichées
par les déclarations sont les valeurs par défaut ; les handlers appliquent celles
capturées au démarrage.

La pagination est distincte : constantes kDrive `limit` **1..200**, défaut **50**,
curseur à renvoyer tant que `hasMore` est vrai ; aucune variable d’environnement ne
les modifie. kChat borne `per_page` à **200** pour les posts. Les listes de services
baseline sans pagination n’inventent ni curseur, ni troncature. Les limites propres
aux champs sont détaillées dans chaque entrée de l’inventaire.

La passerelle partage un bucket de capacité 60, réapprovisionné à un jeton/seconde,
entre produits et tokens. Les retries sont bornés et liés à l’idempotence ; les
mutations ne sont pas automatiquement rejouées. Les URL fournisseur restent fixes
(API Infomaniak, ou base kChat configurée), les segments sont encodés et les
redirections refusées. En exploitation, employer des tokens de portée minimale et
un proxy TLS pour HTTP ; les noms, contenus et descriptions fournisseur restent des
données non fiables pour l’assistant.

## Limites connues et niveau de preuve

`official`, `baseline`, `unproven` décrivent la provenance documentaire, jamais un
succès sur compte fournisseur. Les preuves et leurs sources figurent par outil.

- Les unions fermées `accessRightSchema` et les droits de lien de partage provoquent
  un **rejet DTO explicite** si le fournisseur renvoie une valeur inconnue, pas une
  dégradation. Leur ouverture éventuelle relève d’un cadrage distinct.
- FIX-12A — **routes confirmées en réel le 2026-09-06** par le relevé opérateur :
  `/1/swiss_backups`, `/1/swiss_backups/{backup_id}`, `/slots`,
  `/1/mail_hostings` et `/1/mail_hostings/{mail_id}/mailboxes`.
  Le builder n'a effectué aucun appel fournisseur. Les listes web, certificats,
  Swiss Backup, VPS et serveurs dédiés exigent et transmettent `account_id`.
  Les boîtes sont identifiées par `mailbox_name`, sans `id` obligatoire.
- Les routes mail compatibles (fiche/suppression de boîte, ajout/suppression
  d'alias, suppression de redirection) et le PUT
  `/2/domains/domains/{domain}/nameservers` portent une citation officielle exacte
  dans l'inventaire. Les autres routes douteuses restent inchangées, expérimentales
  et `unproven` ; leurs incompatibilités sont détaillées dans `knownLimits`.
  Le PUT nameservers transmet les noms de serveurs ; l'API en exige au moins deux.
- `/1/web/{hosting_id}/database` est reconnue mais peut répondre
  `not_available_for_this_hosting_type` selon l'hébergement.
- `infomaniak_kchat_search_users` diverge de GET vers POST. La source d’invalidité
  baseline est `mattermost/mattermost`, `api/v4/source/users.yaml`, chemin
  `/api/v4/users/search`, `post` uniquement. La forme corrigée vient de
  `Infomaniak/mobile-kchat` @ `99f2c88f843dcbcc631cb6e587298a4611f020a1`,
  `app/client/rest/users.ts:searchUsers`. Côté kChat, `proof: official` signifie
  « client livré par Infomaniak contre leur backend propriétaire », pas
  « spécification auditée par Infomaniak » (reviewer, 2026-09-05).
- Calendar conserve les dates murales ; les dates avec offset sont converties dans
  le fuseau IANA explicite ou du profil. Les heures ambiguës ou inexistantes lors
  des changements DST ne sont pas désambiguïsées. Calendar utilise l’identité du
  propriétaire du token, pas un identifiant de boîte mail.
- Les routes expérimentales restent non prouvées, notamment les conventions mail
  `/1/mail/...`, domaines par compte, VPS et serveurs dédiés.

## Acceptation hors ligne

```sh
npm ci
npm run verify:mvp
```

Après installation, cette commande est autonome : elle construit le code, contrôle
l’inventaire et rejoue découverte, lectures kDrive/Calendar en read-only, refus de
permanent-delete et POST raw, cycles kDrive et Calendar DST, DTO invalide, refus
HTTP et matrice 2026/2025 sur stdio/HTTP. Elle exécute aussi les tests transports et
interop existants. Elle imprime SHA, état dirty, versions réellement utilisées,
codes de sortie, preuve par outil, matrice, `orphan tools: 0` et `MVP OFFLINE PASS`.
Un handler manquant, une dérive de schéma, un nom orphelin ou un échec de scénario
rend le code non nul. La preuve par outil atteste liaison/schéma et référence de
tests ; elle ne prétend pas exécuter les 111 opérations métier dans la démonstration.

**C3 : zéro token réel, zéro socket vers Infomaniak.** Les appels fournisseur sont
remplacés par des doubles, sans repli réseau. Seule l’écoute locale de transport est
utilisée. Les cycles sont **non prouvés côté fournisseur** ; aucune ressource sandbox
créée, nettoyage sans objet. Le registre reçoit des sentinelles explicites et les
sous-processus de vérification un environnement isolé des secrets opérateur.
L’accès registry est limité à l’installation et à l’audit.

La procédure complète est dans [CONTRIBUTING.md](CONTRIBUTING.md), les limites de
preuve dans [evidence/mvp/README.md](evidence/mvp/README.md), l’architecture dans
[CLAUDE.md](CLAUDE.md) et l’état après refonte dans [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Licence MIT : [LICENSE](LICENSE).

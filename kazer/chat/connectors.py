"""Catálogo de conectores do KAZER.

O que isto é: a lista dos serviços que o KAZER reconhece, organizada por
categoria, com a regra de plano e o peso de uso de cada um. As regras valem no
servidor assim que a conexão abrir — são elas que decidem o que uma conta pode
fazer com um conector e quanto cada tarefa custa da franquia.

O que isto **não** é: nenhum destes serviços está conectado hoje. A conexão
depende de credenciais que o ambiente ainda não tem, e `connected` é sempre
falso até existir uma conexão de verdade. A interface diz isso em vez de fingir
que já dá para ligar.

Regras de plano, como o produto promete:

* Leitura: todo conector lê no plano gratuito, dentro do limite da conta.
* Escrita: depende do conector. O GitHub, por exemplo, lê em qualquer plano,
  mas abrir PR, enviar commit ou rodar ação pede um plano pago.
* Custo: cada conector tem um peso. Gerar arte no Canva gasta mais que ler um
  card do Trello, então o limite acaba mais rápido conforme a tarefa — não
  conforme o relógio.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Pesos: quanto cada chamada de conector soma à cota, além do custo da mensagem.
# Leve = consulta barata; pesado = geração ou processamento longo do outro lado.
WEIGHT_LIGHT = 1
WEIGHT_MEDIUM = 2
WEIGHT_HEAVY = 4


@dataclass(frozen=True, slots=True)
class Connector:
    """Um serviço do catálogo, com o que cada plano pode fazer nele."""

    id: str
    name: str
    category: str
    # Plano mínimo para escrever (criar, alterar, publicar). Vazio: ninguém
    # escreve neste conector — ele é só de leitura para todo mundo.
    write_plan: str
    weight: int

    def public(self, plan_features: dict[str, Any]) -> dict[str, Any]:
        """Forma que a interface consome, já com o que este plano permite."""
        limit = int(plan_features.get("connector_limit") or 0)
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "weight": self.weight,
            "write_plan": self.write_plan,
            # Nenhuma conexão existe ainda: dizer o contrário seria mentira.
            "connected": False,
            "can_read": limit > 0,
            "can_write": bool(self.write_plan) and _plan_at_least(plan_features, self.write_plan),
        }


_PLAN_ORDER = {"free": 0, "pro": 1, "ultra": 2}


def _plan_at_least(plan_features: dict[str, Any], needed: str) -> bool:
    """O plano atual chega ao nível pedido para escrever?"""
    # `connector_limit` é o que distingue os planos no catálogo: 3 no gratuito,
    # 50 no Pro, 500 no Ultra.
    limit = int(plan_features.get("connector_limit") or 0)
    current = "ultra" if limit >= 500 else "pro" if limit >= 50 else "free"
    return _PLAN_ORDER[current] >= _PLAN_ORDER.get(needed, 9)


# ---------------------------------------------------------------------------
# O catálogo
# ---------------------------------------------------------------------------
#
# Por categoria. O padrão de cada categoria está em `_DEFAULTS`; conectores que
# fogem dele aparecem em `_SPECIAL` com a regra própria (o GitHub é o caso que
# o produto promete explicitamente: lê de graça, escreve só no pago).

_DEFAULTS: dict[str, tuple[str, int]] = {
    # categoria: (plano mínimo para escrever, peso)
    "Código e versionamento": ("pro", WEIGHT_MEDIUM),
    "Design e criação": ("pro", WEIGHT_HEAVY),
    "Documentos e notas": ("free", WEIGHT_LIGHT),
    "Planilhas e dados": ("free", WEIGHT_LIGHT),
    "Projetos e tarefas": ("free", WEIGHT_LIGHT),
    "Comunicação": ("pro", WEIGHT_LIGHT),
    "E-mail e agenda": ("pro", WEIGHT_LIGHT),
    "Armazenamento": ("free", WEIGHT_LIGHT),
    "Bancos de dados": ("pro", WEIGHT_MEDIUM),
    "Nuvem e infraestrutura": ("pro", WEIGHT_MEDIUM),
    "Observabilidade": ("pro", WEIGHT_LIGHT),
    "CI e automação": ("pro", WEIGHT_MEDIUM),
    "Sites e publicação": ("pro", WEIGHT_MEDIUM),
    "Comércio e pagamentos": ("ultra", WEIGHT_MEDIUM),
    "Vendas e atendimento": ("pro", WEIGHT_LIGHT),
    "Marketing e e-mail": ("pro", WEIGHT_MEDIUM),
    "Analytics e produto": ("free", WEIGHT_LIGHT),
    "Redes sociais": ("ultra", WEIGHT_MEDIUM),
    "Vídeo e áudio": ("pro", WEIGHT_HEAVY),
    "IA e modelos": ("pro", WEIGHT_HEAVY),
    "Busca e índices": ("pro", WEIGHT_MEDIUM),
    "RH e pessoas": ("ultra", WEIGHT_LIGHT),
    "Finanças e contabilidade": ("ultra", WEIGHT_MEDIUM),
    "Jurídico e assinatura": ("ultra", WEIGHT_MEDIUM),
    "Educação e pesquisa": ("free", WEIGHT_LIGHT),
    "Mapas e logística": ("pro", WEIGHT_MEDIUM),
    "Saúde e bem-estar": ("ultra", WEIGHT_LIGHT),
    "Jogos e comunidades": ("pro", WEIGHT_LIGHT),
    "Produtividade pessoal": ("free", WEIGHT_LIGHT),
    "Segurança e identidade": ("ultra", WEIGHT_MEDIUM),
}

# Conectores com regra própria, fora do padrão da categoria.
_SPECIAL: dict[str, tuple[str, int]] = {
    # O que o produto promete: GitHub lê em qualquer plano; programar nele
    # (commit, PR, ação) é dos planos pagos.
    "github": ("pro", WEIGHT_MEDIUM),
    "gitlab": ("pro", WEIGHT_MEDIUM),
    "bitbucket": ("pro", WEIGHT_MEDIUM),
    # Canva entra no gratuito, mas gerar arte do outro lado custa caro: o limite
    # acaba mais rápido conforme a tarefa.
    "canva": ("free", WEIGHT_HEAVY),
    "figma": ("free", WEIGHT_HEAVY),
}

_CATALOG_SOURCE: dict[str, tuple[str, ...]] = {
    "Código e versionamento": (
        "GitHub", "GitLab", "Bitbucket", "Gitea", "Forgejo", "Azure DevOps", "SourceHut",
        "Codeberg", "Gerrit", "Phabricator", "Sourcegraph", "CodeSandbox", "StackBlitz",
        "Replit", "Glitch", "JSFiddle", "CodePen", "Gist", "Radicle", "Perforce",
        "Mercurial", "Subversion", "Buildkite", "Semgrep", "SonarQube", "Codecov",
        "Coveralls", "Snyk", "Dependabot", "Renovate", "Mend", "DeepSource",
        "CodeClimate", "Qodana", "Danger", "Reviewable", "Graphite", "Aviator",
        "Mergify", "Trunk",
    ),
    "Design e criação": (
        "Figma", "Canva", "Sketch", "Adobe XD", "Framer", "Penpot", "InVision", "Zeplin",
        "Abstract", "Marvel", "Balsamiq", "Whimsical", "Excalidraw", "tldraw", "Miro",
        "FigJam", "Lucidchart", "Draw.io", "Affinity Designer", "Photoshop",
        "Illustrator", "Lightroom", "Procreate", "Spline", "Rive", "Lottie",
        "Blender", "Cinema 4D", "Unity", "Unreal Engine", "Dribbble", "Behance",
        "Unsplash", "Pexels", "Pixabay", "Iconify", "Noun Project", "Font Awesome",
        "Google Fonts", "Adobe Fonts",
    ),
    "Documentos e notas": (
        "Notion", "Confluence", "Google Docs", "Microsoft Word", "Coda", "Craft",
        "Obsidian", "Roam Research", "Logseq", "Bear", "Evernote", "OneNote",
        "Apple Notes", "Standard Notes", "Joplin", "Dropbox Paper", "Quip", "Slite",
        "Nuclino", "Tettra", "Guru", "Almanac", "Outline", "BookStack", "Docusaurus",
        "GitBook", "ReadMe", "Mintlify", "Archbee", "Document360", "HackMD",
        "Dendron", "Anytype", "Capacities", "Tana", "Mem", "Reflect", "Supernotes",
        "Walling", "Milanote",
    ),
    "Planilhas e dados": (
        "Google Sheets", "Microsoft Excel", "Airtable", "Baserow", "NocoDB", "Smartsheet",
        "Rows", "Equals", "Grist", "SeaTable", "Quickbase", "Knack", "Stackby",
        "Coda Tables", "Notion Databases", "Fibery", "Teable", "Softr", "Glide",
        "AppSheet", "Retool", "Budibase", "Appsmith", "ToolJet", "Internal",
        "Observable", "Deepnote", "Hex", "Mode", "Count",
    ),
    "Projetos e tarefas": (
        "Linear", "Jira", "Asana", "Trello", "ClickUp", "Monday", "Basecamp", "Wrike",
        "Teamwork", "Height", "Shortcut", "Pivotal Tracker", "YouTrack", "Redmine",
        "Taiga", "OpenProject", "Zenhub", "Plane", "Vikunja", "Focalboard",
        "Productboard", "Aha!", "Roadmunk", "Craft.io", "Jira Service Management",
        "Azure Boards", "Sprintly", "Nifty", "Hive", "Paymo",
    ),
    "Comunicação": (
        "Slack", "Microsoft Teams", "Discord", "Telegram", "WhatsApp Business", "Signal",
        "Matrix", "Mattermost", "Rocket.Chat", "Zulip", "Twist", "Chanty", "Flock",
        "Google Chat", "Zoom Team Chat", "Webex", "Element", "Revolt", "Guilded",
        "Threema", "Line", "Viber", "WeChat Work", "Lark", "DingTalk", "Pumble",
        "Troop Messenger", "Ryver", "Spike", "Missive",
    ),
    "E-mail e agenda": (
        "Gmail", "Outlook", "Google Calendar", "Outlook Calendar", "Fastmail", "Proton Mail",
        "Zoho Mail", "Hey", "Superhuman", "Spark", "Missive Mail", "Front",
        "Calendly", "Cal.com", "SavvyCal", "Doodle", "Motion", "Reclaim",
        "Clockwise", "Vimcal", "Fantastical", "Morgen", "Amie", "Sunsama",
        "Akiflow", "Routine", "TimeTree", "Any.do Calendar", "Zoho Calendar",
        "Apple Calendar",
    ),
    "Armazenamento": (
        "Google Drive", "Dropbox", "OneDrive", "Box", "iCloud Drive", "pCloud", "Sync.com",
        "Mega", "Nextcloud", "ownCloud", "Seafile", "Amazon S3", "Google Cloud Storage",
        "Azure Blob Storage", "Cloudflare R2", "Backblaze B2", "Wasabi", "DigitalOcean Spaces",
        "MinIO", "Storj", "Filebase", "Bunny Storage", "Vercel Blob", "Supabase Storage",
        "Firebase Storage", "Uploadcare", "Cloudinary", "ImageKit", "Filestack", "Transloadit",
    ),
    "Bancos de dados": (
        "PostgreSQL", "MySQL", "MariaDB", "SQLite", "MongoDB", "Redis", "Cassandra",
        "DynamoDB", "Firestore", "Supabase", "PlanetScale", "Neon", "CockroachDB",
        "TimescaleDB", "InfluxDB", "ClickHouse", "DuckDB", "SingleStore", "YugabyteDB",
        "Couchbase", "RethinkDB", "ArangoDB", "Neo4j", "Dgraph", "FaunaDB", "Turso",
        "Xata", "Prisma", "Hasura", "PostgREST", "EdgeDB", "SurrealDB", "TiDB",
        "Vitess", "Aurora", "Cloud SQL", "Azure SQL", "Oracle Database", "SQL Server",
        "Snowflake",
    ),
    "Nuvem e infraestrutura": (
        "AWS", "Google Cloud", "Microsoft Azure", "Vercel", "Netlify", "Cloudflare",
        "DigitalOcean", "Linode", "Vultr", "Hetzner", "Fly.io", "Railway", "Render",
        "Heroku", "Koyeb", "Northflank", "Porter", "Qovery", "Scaleway", "OVHcloud",
        "IBM Cloud", "Oracle Cloud", "Alibaba Cloud", "Kubernetes", "Docker Hub",
        "Terraform", "Pulumi", "Ansible", "Nomad", "Consul", "Vault", "Helm",
        "ArgoCD", "Flux", "Rancher", "OpenShift", "Portainer", "Coolify", "Dokku",
        "CapRover",
    ),
    "Observabilidade": (
        "Datadog", "Sentry", "New Relic", "Grafana", "Prometheus", "PagerDuty", "Opsgenie",
        "Splunk", "Elastic", "Honeycomb", "Lightstep", "Dynatrace", "AppDynamics",
        "Rollbar", "Bugsnag", "Airbrake", "Raygun", "LogRocket", "FullStory",
        "Highlight", "Better Stack", "Uptime Robot", "Pingdom", "StatusCake",
        "Checkly", "Cronitor", "Healthchecks", "Instatus", "Statuspage", "Incident.io",
    ),
    "CI e automação": (
        "GitHub Actions", "GitLab CI", "CircleCI", "Jenkins", "Travis CI", "Drone",
        "TeamCity", "Bamboo", "Woodpecker", "Earthly", "Dagger", "Nx Cloud",
        "Turborepo", "Zapier", "Make", "n8n", "Pipedream", "Workato", "Tray.io",
        "Integromat", "IFTTT", "Activepieces", "Windmill", "Temporal", "Inngest",
        "Trigger.dev", "Hatchet", "Celery", "Airflow", "Dagster", "Prefect",
        "Mage", "Kestra", "Argo Workflows", "Step Functions",
    ),
    "Sites e publicação": (
        "WordPress", "Webflow", "Squarespace", "Wix", "Ghost", "Substack", "Medium",
        "Shopify Pages", "Hashnode", "Dev.to", "Bear Blog", "Micro.blog", "Blogger",
        "Tumblr", "Jekyll", "Hugo", "Astro", "Next.js", "Nuxt", "SvelteKit",
        "Gatsby", "Eleventy", "Contentful", "Sanity", "Strapi", "Payload", "Directus",
        "Prismic", "Storyblok", "DatoCMS", "Hygraph", "Keystone", "Tina", "Netlify CMS",
        "Builder.io",
    ),
    "Comércio e pagamentos": (
        "Stripe", "PayPal", "Mercado Pago", "PagSeguro", "Pagar.me", "Asaas", "Iugu",
        "Gerencianet", "Cielo", "Rede", "Stone", "SumUp", "Square", "Adyen",
        "Mollie", "Klarna", "Razorpay", "Paddle", "Lemon Squeezy", "Gumroad",
        "Shopify", "WooCommerce", "Magento", "BigCommerce", "PrestaShop", "VTEX",
        "Nuvemshop", "Loja Integrada", "Tray Commerce", "Yampi", "Hotmart",
        "Kiwify", "Eduzz", "Monetizze", "Braintree",
    ),
    "Vendas e atendimento": (
        "Salesforce", "HubSpot", "Pipedrive", "Zoho CRM", "Close", "Copper", "Freshsales",
        "Insightly", "Nutshell", "Attio", "Folk", "Streak", "Apollo", "Outreach",
        "Salesloft", "Gong", "Chorus", "Clari", "Zendesk", "Intercom", "Freshdesk",
        "Help Scout", "Crisp", "Tidio", "LiveChat", "Drift", "Front Desk",
        "Gorgias", "Kustomer", "Gladly", "Hiver", "Groove", "Jira Service Desk",
        "ServiceNow", "Movidesk",
    ),
    "Marketing e e-mail": (
        "Mailchimp", "SendGrid", "Brevo", "Klaviyo", "ActiveCampaign", "ConvertKit",
        "Customer.io", "Iterable", "Braze", "OneSignal", "Postmark", "Mailgun",
        "Resend", "Loops", "Beehiiv", "Buttondown", "MailerLite", "GetResponse",
        "AWeber", "Constant Contact", "Drip", "Omnisend", "Moosend", "Mautic",
        "RD Station", "Leadlovers", "E-goi", "Mailtrap", "Amazon SES", "SparkPost",
    ),
    "Analytics e produto": (
        "Google Analytics", "Plausible", "Fathom", "Matomo", "Umami", "PostHog", "Mixpanel",
        "Amplitude", "Heap", "Pendo", "Hotjar", "Microsoft Clarity", "Smartlook",
        "Contentsquare", "Quantum Metric", "Statsig", "LaunchDarkly", "Optimizely",
        "GrowthBook", "Unleash", "Flagsmith", "Split", "VWO", "AB Tasty",
        "Google Tag Manager", "Segment", "RudderStack", "Jitsu", "Snowplow", "Freshpaint",
    ),
    "Redes sociais": (
        "X", "Instagram", "Facebook", "LinkedIn", "TikTok", "YouTube", "Pinterest",
        "Reddit", "Threads", "Bluesky", "Mastodon", "Snapchat", "Tumblr Social",
        "VK", "Weibo", "Kuaishou", "Twitch", "Kick", "Rumble", "Vimeo",
        "Buffer", "Hootsuite", "Later", "Sprout Social", "Sprinklr", "Loomly",
        "Planoly", "SocialBee", "Metricool", "mLabs",
    ),
    "Vídeo e áudio": (
        "YouTube Studio", "Vimeo Pro", "Loom", "Descript", "Riverside", "Zoom", "Google Meet",
        "Whereby", "Around", "Mux", "Cloudflare Stream", "Bunny Stream", "JW Player",
        "Brightcove", "Wistia", "Vidyard", "Spotify", "Apple Podcasts", "Anchor",
        "Buzzsprout", "Transistor", "Captivate", "Podbean", "Castos", "ElevenLabs",
        "Murf", "Play.ht", "AssemblyAI", "Deepgram", "Whisper", "Rev", "Otter",
        "Fireflies", "Grain", "tl;dv",
    ),
    "IA e modelos": (
        "OpenAI", "Anthropic", "Google AI", "Mistral", "Cohere", "Groq", "Together AI",
        "Fireworks AI", "Perplexity", "Hugging Face", "Replicate", "Modal", "Baseten",
        "Banana", "RunPod", "Lambda Labs", "Vast.ai", "Stability AI", "Midjourney",
        "Leonardo AI", "Ideogram", "Runway", "Pika", "Luma AI", "Suno", "Udio",
        "LangSmith", "LangFuse", "Weights & Biases", "Comet ML", "MLflow", "Neptune",
        "ClearML", "DVC", "Label Studio",
    ),
    "Busca e índices": (
        "Algolia", "Typesense", "Meilisearch", "Elasticsearch", "OpenSearch", "Solr",
        "Pinecone", "Weaviate", "Qdrant", "Chroma", "Milvus", "Vespa", "Vald",
        "LanceDB", "pgvector", "Redis Search", "Marqo", "Zilliz", "Deep Lake",
        "Vectara", "SearchAPI", "SerpAPI", "Brave Search", "Exa", "Tavily",
        "You.com", "Kagi", "Bing Search", "DuckDuckGo", "Common Crawl",
    ),
    "RH e pessoas": (
        "Workday", "BambooHR", "Gusto", "Rippling", "Deel", "Remote", "Oyster",
        "Personio", "HiBob", "Namely", "Zenefits", "Justworks", "TriNet", "Paylocity",
        "Paycom", "ADP", "Greenhouse", "Lever", "Ashby", "Workable", "SmartRecruiters",
        "Recruitee", "Teamtailor", "Breezy", "JazzHR", "Gupy", "Solides", "Sesame",
        "Factorial", "Culture Amp",
    ),
    "Finanças e contabilidade": (
        "QuickBooks", "Xero", "FreshBooks", "Wave", "Sage", "NetSuite", "Zoho Books",
        "Conta Azul", "Omie", "Bling", "Tiny ERP", "Nibo", "Granatum", "Expensify",
        "Ramp", "Brex", "Navan", "Pleo", "Spendesk", "Payhawk", "Mercury",
        "Brankas", "Plaid", "Belvo", "Pluggy", "Nubank", "Inter", "Itaú", "Bradesco",
        "Banco do Brasil",
    ),
    "Jurídico e assinatura": (
        "DocuSign", "Adobe Sign", "HelloSign", "PandaDoc", "SignNow", "Clicksign",
        "ZapSign", "D4Sign", "Autentique", "Docusign CLM", "Ironclad", "ContractWorks",
        "Juro", "LinkSquares", "Evisort", "Lexion", "Icertis", "Agiloft", "Conga",
        "Concord", "Oneflow", "Scrive", "Yousign", "Eversign", "SignRequest",
        "RightSignature", "Signaturit", "Certisign", "Serpro", "Gov.br",
    ),
    "Educação e pesquisa": (
        "Google Scholar", "arXiv", "PubMed", "Semantic Scholar", "Zotero", "Mendeley",
        "EndNote", "Paperpile", "Connected Papers", "Research Rabbit", "Elicit",
        "Consensus", "Scite", "JSTOR", "SSRN", "ORCID", "Crossref", "OpenAlex",
        "Moodle", "Canvas LMS", "Blackboard", "Google Classroom", "Coursera",
        "Udemy", "edX", "Khan Academy", "Duolingo", "Anki", "Quizlet", "Notion AI",
    ),
    "Mapas e logística": (
        "Google Maps", "Mapbox", "OpenStreetMap", "HERE", "TomTom", "Apple Maps",
        "Waze", "Correios", "FedEx", "DHL", "UPS", "Jadlog", "Loggi", "Melhor Envio",
        "Frenet", "Kangu", "ShipStation", "EasyPost", "Shippo", "AfterShip",
        "ParcelPanel", "Route", "Onfleet", "Bringg", "Routific", "Circuit",
        "OptimoRoute", "Samsara", "Geotab", "Fleetio",
    ),
    "Saúde e bem-estar": (
        "Apple Health", "Google Fit", "Fitbit", "Garmin", "Whoop", "Oura", "Strava",
        "MyFitnessPal", "Cronometer", "Withings", "Polar", "Suunto", "Peloton",
        "Headspace", "Calm", "Insight Timer", "Noom", "Zepp", "Samsung Health",
        "Epic", "Cerner", "Athenahealth", "DrChrono", "SimplePractice", "Doctoralia",
        "iClinic", "Conexa", "Memed", "Tasy", "MV",
    ),
    "Jogos e comunidades": (
        "Steam", "Epic Games", "GOG", "itch.io", "Xbox", "PlayStation Network",
        "Nintendo", "Riot Games", "Battle.net", "Roblox", "Minecraft", "Discord Bots",
        "Guilded Communities", "Circle", "Mighty Networks", "Skool", "Discourse",
        "Flarum", "NodeBB", "phpBB", "Tribe", "Bettermode", "Hivebrite", "Disciple",
        "Patreon", "Ko-fi", "Buy Me a Coffee", "Liberapay", "Open Collective", "GitHub Sponsors",
    ),
    "Produtividade pessoal": (
        "Todoist", "Things", "TickTick", "Microsoft To Do", "Google Tasks", "Any.do",
        "OmniFocus", "Amazing Marvin", "Superlist", "Tweek", "Habitica", "Streaks",
        "Loop Habit", "Toggl", "Clockify", "Harvest", "RescueTime", "Timing",
        "Rize", "Forest", "Pocket", "Instapaper", "Readwise", "Raindrop",
        "Matter", "Omnivore", "Feedly", "Inoreader", "NewsBlur", "Miniflux",
    ),
    "Segurança e identidade": (
        "1Password", "Bitwarden", "LastPass", "Dashlane", "KeePass", "Keeper",
        "Auth0", "Okta", "Clerk", "WorkOS", "Stytch", "Descope", "FusionAuth",
        "Keycloak", "Ory", "SuperTokens", "Firebase Auth", "AWS Cognito", "Azure AD",
        "Google Identity", "Duo", "Yubico", "Authy", "Twilio Verify", "HaveIBeenPwned",
        "Cloudflare Access", "Tailscale", "ZeroTier", "WireGuard", "Teleport",
    ),
}


def _build() -> tuple[Connector, ...]:
    """Monta o catálogo, aplicando o padrão da categoria e as regras próprias."""
    items: list[Connector] = []
    seen: set[str] = set()
    for category, names in _CATALOG_SOURCE.items():
        default_plan, default_weight = _DEFAULTS[category]
        for name in names:
            key = _slug(name)
            # O mesmo produto pode aparecer em duas categorias: fica na primeira.
            if key in seen:
                continue
            seen.add(key)
            plan, weight = _SPECIAL.get(key, (default_plan, default_weight))
            items.append(Connector(key, name, category, plan, weight))
    return tuple(items)


def _slug(name: str) -> str:
    """`Google Cloud Storage` vira `google-cloud-storage`."""
    clean = "".join(char if char.isalnum() else " " for char in name.lower())
    return "-".join(clean.split())


CATALOG: tuple[Connector, ...] = _build()
BY_ID: dict[str, Connector] = {item.id: item for item in CATALOG}
CATEGORIES: tuple[str, ...] = tuple(_CATALOG_SOURCE)


def search(
    query: str = "", category: str = "", *, limit: int = 60, offset: int = 0
) -> tuple[list[Connector], int]:
    """Busca por nome e categoria; devolve a página e o total encontrado."""
    needle = _slug(query)
    found = [
        item
        for item in CATALOG
        if (not needle or needle in item.id)
        and (not category or item.category == category)
    ]
    return found[offset : offset + limit], len(found)


def weight_of(ids: list[str]) -> int:
    """Quanto os conectores de um pedido somam à cota."""
    return sum(BY_ID[item].weight for item in ids if item in BY_ID)

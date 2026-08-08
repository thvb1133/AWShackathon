/* ============================================================
   ventures.js — fifty space/AI/quantum software businesses,
   as structured data rather than a list to admire.

   Every entry carries the things that actually decide whether you
   should build it: who pays, what they pay, what has to exist before
   a first customer, how much of it you can build with the skills you
   already have, and what genuinely blocks it.

   Two deliberate honesty rules run through this file.

   1. `price` is a *pricing model*, not a prediction. Nothing here
      forecasts what you will earn, because nobody can. What the
      scoring does is rank ideas by how cheaply they can be tested.

   2. `blockers` is never empty. An idea with no listed obstacle has
      not been thought about hard enough, and a plan that hides its
      obstacles costs far more later than it saves now.
   ============================================================ */

/** Revenue archetypes, with the economics that follow from each. */
export const MODELS = {
  saas: { label: "Monthly SaaS", emoji: "🔁", note: "Recurring, predictable, slow to start. The default for dashboards." },
  api: { label: "Usage-based API", emoji: "🔌", note: "Developers integrate once and pay per call. Scales without support load." },
  seat: { label: "Per-seat licence", emoji: "👤", note: "Sold to teams. Higher price, longer sales cycle." },
  perasset: { label: "Per asset monitored", emoji: "📍", note: "Per farm, site, vessel or property. Grows with the customer." },
  report: { label: "Per report", emoji: "📄", note: "Transactional. Easiest first sale, hardest to make recurring." },
  contract: { label: "Enterprise contract", emoji: "🏛️", note: "Large, slow, procurement-heavy. Usually needs references first." },
  marketplace: { label: "Marketplace take", emoji: "🏪", note: "A cut of other people's transactions. Needs both sides at once." },
};

/** How hard it is to reach a first paying customer, not to write the code. */
export const DIFFICULTY = {
  1: "A weekend prototype, a real customer within weeks",
  2: "Buildable solo, weeks of work before a demo is credible",
  3: "Needs paid data or real domain accuracy before anyone buys",
  4: "Needs regulated accuracy, references, or a large integration",
  5: "Research-grade. Fund it as R&D, not as a first business",
};

/* Fields: id, name, category, model, price, buyer, difficulty,
   data, stack, edge, blockers, quantum */
const RAW = [
  /* ---------------- A. Satellite + AI ---------------- */
  ["sat-image-analyzer", "AI Satellite Image Analyzer", "earth", "saas", "£29–£499/mo", "Analysts, small consultancies", 2,
    "Sentinel-2 (free, ESA Copernicus)", "Python, PyTorch, FastAPI, Postgres, JS dashboard",
    "Free Sentinel data means zero data cost while you validate demand.",
    "Generic. “Analyse imagery” is not a purchase decision — pick one vertical or compete with everyone.",
    "A classifier is the obvious QML target, and the honest one: benchmark against a CNN before claiming anything."],
  ["farm-monitor", "AI Farm Monitoring", "earth", "perasset", "£15–£80 per farm", "Farmers, agronomists, co-ops", 2,
    "Sentinel-2 NDVI/NDRE, weather APIs (free)", "Python, rasterio, scikit-learn, JS maps",
    "NDVI is well understood, cheap to compute, and visibly useful within one season.",
    "Farmers buy in season and judge on last year's yield. Long cycle, price-sensitive, heavy hand-holding.",
    "Marginal. Classical indices already work; QML adds nothing a farmer would pay for."],
  ["property-monitor", "Satellite Property Monitor", "earth", "perasset", "£5–£40 per property", "Asset managers, lenders", 3,
    "High-res commercial imagery (paid)", "Python, change detection, PHP/JS portal",
    "Change detection is a well-posed ML problem with an obvious alert product.",
    "Sentinel's 10 m resolution cannot see most property-level change. Useful resolution costs real money per km².",
    "No credible advantage."],
  ["construction-tracker", "Construction Progress Tracker", "earth", "saas", "£99–£999/mo", "Contractors, surveyors, lenders", 3,
    "Commercial high-res imagery, frequent revisit", "Python, segmentation, time-series, dashboard",
    "A lender releasing staged finance genuinely needs independent proof of progress.",
    "Resolution and revisit cost. Drones already serve a single site more cheaply.",
    "No."],
  ["mining-detect", "Mining Activity Detection", "earth", "contract", "£2k–£20k", "Mining firms, regulators, ESG funds", 3,
    "Sentinel-1 SAR + Sentinel-2 (free)", "Python, SAR processing, PyTorch",
    "SAR sees through cloud, which matters in tropical mining regions.",
    "Buyers are few, procurement is slow, and each wants a bespoke pilot.",
    "Possible for SAR classification; unproven."],
  ["deforest", "Illegal Deforestation Detector", "earth", "contract", "£5k–£50k", "Governments, NGOs, commodity buyers", 3,
    "Sentinel-2, Landsat, GLAD alerts (free)", "Python, time-series change detection",
    "EU deforestation regulation created a compliance reason to buy, not just a moral one.",
    "Global Forest Watch already provides much of this free. You must beat free on latency or accuracy.",
    "Marginal."],
  ["wildfire", "Wildfire Early Warning", "earth", "contract", "£10k–£100k", "Insurers, utilities, fire services", 4,
    "MODIS/VIIRS thermal, GOES (free)", "Python, streaming pipeline, alerting",
    "Utilities face liability for fires their equipment starts, so the budget genuinely exists.",
    "Life-safety accuracy bar. A false negative is a catastrophe and a lawsuit. Not a solo first product.",
    "No. Latency matters far more than model exotica."],
  ["flood-risk", "Flood Risk AI", "earth", "api", "£0.05–£2 per lookup", "Insurers, lenders, conveyancers", 3,
    "Sentinel-1 SAR flood extent, DEMs (free)", "Python, SAR, geospatial, API",
    "A per-property flood score is a clean API product with an obvious buyer.",
    "JBA and Fathom are established and trusted by regulators.",
    "No."],
  ["insurance-claims", "Satellite Insurance Claims Analyzer", "earth", "report", "£3–£40 per claim", "Insurers, loss adjusters", 4,
    "Pre/post-event high-res imagery (paid)", "Python, change detection, claims integration",
    "After a storm, adjusters are the bottleneck. Triage by satellite is genuinely valuable.",
    "Insurers buy through procurement and need audit trails, not a clever demo.",
    "No."],
  ["infra-damage", "Infrastructure Damage Detection", "earth", "contract", "£5k–£60k", "Utilities, rail, insurers", 4,
    "InSAR ground deformation, high-res optical", "Python, InSAR, ML",
    "InSAR millimetre subsidence detection is genuinely hard to replicate.",
    "InSAR expertise is specialist, and getting it wrong on a bridge is unthinkable.",
    "No."],
  ["oilgas", "Oil & Gas Infrastructure Monitor", "earth", "contract", "£10k–£150k", "Energy majors, regulators", 4,
    "Methane spectrometry (Sentinel-5P free, GHGSat paid)", "Python, spectral analysis",
    "Methane regulation is tightening fast and fines are large.",
    "GHGSat and Kayrros already own this. Very hard to enter.",
    "No."],
  ["solar-monitor", "Solar Farm Monitor", "earth", "perasset", "£20–£200 per site", "Solar operators, funds", 2,
    "Thermal + optical imagery, production data", "Python, anomaly detection",
    "Underperforming panels are measurable and the loss is quantifiable in pounds.",
    "Operators already have SCADA telemetry that beats satellite for this.",
    "No."],
  ["wind-monitor", "Wind Farm Monitoring", "earth", "perasset", "£30–£300 per site", "Energy operators", 3,
    "SAR, optical, wake modelling", "Python, CFD-lite, ML",
    "Wake-loss analysis across a whole farm is a real optimisation question.",
    "Turbine SCADA again beats satellite for most failure modes.",
    "Wake optimisation is combinatorial — the strongest QML fit in this section."],
  ["port-intel", "Port Activity Intelligence", "earth", "saas", "£500–£5k/mo", "Traders, logistics, hedge funds", 3,
    "Sentinel-1/2, AIS ship data (free tiers)", "Python, object detection, AIS fusion",
    "Traders pay for a signal hours before the official statistics.",
    "Orbital Insight and Kpler already sell this to exactly those buyers.",
    "No."],
  ["ship-detect", "Ship Detection & Tracking", "earth", "api", "£0.01–£0.5 per scene", "Maritime, defence, fisheries", 3,
    "Sentinel-1 SAR, AIS (free)", "Python, SAR object detection",
    "Dark-vessel detection — ships with AIS switched off — is well defined and valuable.",
    "Defence buyers need clearances; commercial buyers are few and already served.",
    "Marginal."],
  ["carbon-monitor", "Satellite Carbon Monitor", "earth", "saas", "£200–£3k/mo", "ESG teams, carbon registries", 3,
    "Biomass estimation, Sentinel, GEDI lidar (free)", "Python, biomass models",
    "Carbon credit fraud is a real scandal; independent verification has genuine demand.",
    "Scientific credibility bar is very high and the market is under heavy scrutiny.",
    "No."],
  ["urban-growth", "Urban Growth Intelligence", "earth", "saas", "£100–£2k/mo", "Developers, planners, retail siting", 2,
    "Sentinel-2, VIIRS night lights, OSM (free)", "Python, change detection, JS maps",
    "Night lights plus built-up change is cheap, free, and genuinely predictive.",
    "Slow-moving decisions mean slow-moving budgets.",
    "No."],
  ["road-bridge", "Road & Bridge Condition Monitor", "earth", "contract", "£10k–£100k", "Highways authorities, engineers", 4,
    "InSAR deformation", "Python, InSAR",
    "Public asset owners have maintenance backlogs and statutory duties.",
    "Public procurement. Expect eighteen months to a first contract.",
    "No."],
  ["water-pollution", "Water Pollution Detector", "earth", "contract", "£5k–£50k", "Regulators, water firms, campaigners", 3,
    "Sentinel-2 water bands, Sentinel-3 (free)", "Python, spectral indices",
    "UK sewage discharge is politically hot and evidence is in demand right now.",
    "Regulatory-grade evidence needs ground truth, not just spectra.",
    "No."],
  ["climate-api", "Climate Intelligence API", "earth", "api", "£0.001–£0.1 per call", "Any developer", 2,
    "ERA5 reanalysis, Copernicus climate (free)", "Python, FastAPI, caching, Postgres",
    "Pure software. No imagery cost, no ground truth problem, instant global coverage.",
    "Free data means free competitors. You sell convenience, so you must be genuinely convenient.",
    "No."],

  /* ---------------- B. Space operations + AI ---------------- */
  ["mission-planner", "AI Satellite Mission Planner", "ops", "saas", "£500–£10k/mo", "Satellite operators, ground segment", 3,
    "TLEs (free, CelesTrak), target lists", "Python, optimisation, scheduling, JS",
    "A pure optimisation problem needing no imagery licence — and Beyond Orbit already implements it.",
    "Operators are few and conservative. Selling into flight operations takes credibility you must build.",
    "The strongest genuine fit on this list. Task selection under constraints is exactly a QUBO."],
  ["health-monitor", "AI Satellite Health Monitor", "ops", "saas", "£1k–£20k/mo", "Satellite operators", 3,
    "Telemetry (the customer's own)", "Python, time-series anomaly detection",
    "Predictive maintenance on a £50m asset justifies almost any software price.",
    "You need a customer's telemetry before you can build it — a chicken-and-egg problem.",
    "Marginal."],
  ["anomaly-saas", "Telemetry Anomaly Detection", "ops", "saas", "£1k–£15k/mo", "Operators, ground stations", 3,
    "Customer telemetry streams", "Python, autoencoders, streaming",
    "Unsupervised detection needs no labelled failures, which operators do not have.",
    "Same data access problem, plus very high false-positive intolerance.",
    "Marginal."],
  ["ground-scheduler", "Ground Station Scheduler", "ops", "saas", "£500–£8k/mo", "Ground station networks", 3,
    "Pass predictions from TLEs (free)", "Python, constraint solving, JS",
    "Antenna contention is a genuine constraint problem and TLEs are free.",
    "AWS Ground Station and KSAT bundle scheduling with the antennas themselves.",
    "Yes — scheduling under contention is a real QUBO."],
  ["data-compression", "Satellite Data Compression AI", "ops", "api", "Licence, £10k+", "Satellite manufacturers", 4,
    "Representative imagery", "Python, learned compression, embedded C",
    "Downlink bandwidth is the hard constraint on every EO constellation.",
    "Flight software qualification and radiation tolerance. Years, not months.",
    "No."],
  ["onboard-filter", "Onboard Data Filter", "ops", "api", "Licence, £10k+", "Constellation operators", 4,
    "Imagery, edge hardware", "Python, TinyML, ONNX, embedded",
    "ESA's Φsat-2 proved the concept flies, so the demand is real.",
    "Requires flight heritage nobody gives a first-time supplier.",
    "No."],
  ["digital-twin", "Spacecraft Digital Twin", "ops", "seat", "£200–£2k per seat", "Engineering teams", 3,
    "Spacecraft parameters, orbital mechanics (free)", "Python, simulation, three.js",
    "Beyond Orbit already has the 3D and orbital mechanics half of this built.",
    "Ansys, STK and GMAT are entrenched and very good.",
    "No."],
  ["ops-copilot", "Satellite Operations Copilot", "ops", "seat", "£100–£1k per seat", "Flight operators", 2,
    "Procedures, telemetry, TLEs", "LLM API, RAG, Python",
    "An assistant grounded in real orbital computation — exactly the pipeline this app already runs.",
    "Operators will not let a language model near a live spacecraft. Position it as advisory only.",
    "No."],
  ["orbit-optimizer", "Orbit Optimisation", "ops", "api", "£1k–£20k", "Operators, mission designers", 3,
    "Orbital elements, thrust models", "Python, trajectory optimisation",
    "Manoeuvre fuel is literally mission lifetime; savings convert directly to money.",
    "Deep astrodynamics expertise is required before anyone trusts you.",
    "Yes, for multi-objective constellation configuration."],
  ["mission-sim", "Browser Mission Simulator", "ops", "saas", "£10–£200/mo", "Students, universities, hobbyists", 1,
    "Public orbital data only (free)", "JS, three.js, WebGL",
    "Beyond Orbit is already most of this product. Education is a real, if small, market.",
    "Education budgets are tiny. Treat this as a funnel, not a business.",
    "No, but it is the ideal shop window for the quantum work."],

  /* ---------------- C. Quantum ML + Space ---------------- */
  ["q-mission-opt", "Quantum Mission Optimiser", "quantum", "saas", "£2k–£30k/mo", "Operators with task backlogs", 4,
    "Task lists, constraints (free to simulate)", "Python, Qiskit/PennyLane, QAOA, classical baseline",
    "Idea #31, and the one implemented in this application: a real QUBO with a real quantum solver beside a real classical one.",
    "Classical solvers currently win at every size you can run on today's hardware. Sell the optimisation; treat quantum as research.",
    "This is the fit. Task selection under capacity is a textbook QUBO."],
  ["q-orbit", "Quantum Orbit Optimiser", "quantum", "api", "£5k–£50k", "Constellation designers", 5,
    "Orbital parameters (free)", "PennyLane, variational algorithms",
    "Continuous-variable optimisation is a live quantum research area.",
    "Continuous problems map poorly to current gate hardware.",
    "Speculative."],
  ["q-image-classify", "Quantum Satellite Image Classifier", "quantum", "api", "£0.01–£1 per image", "EO analytics firms", 4,
    "EuroSAT labelled imagery (free)", "PennyLane, PyTorch hybrid, quantum kernels",
    "EuroSAT is a free standard benchmark, so the comparison can be honest and public.",
    "Published gains are small, on tiny subsets, and often vanish against a properly tuned CNN.",
    "The literature's main claim. Reproduce it before you sell it."],
  ["q-eo-classify", "Quantum EO Land-Cover Classifier", "quantum", "api", "£0.01–£1 per image", "Mapping agencies, agri", 4,
    "Sentinel-2 land cover labels (free)", "Quantum kernels, hybrid models",
    "Land-cover classification has abundant free labelled data.",
    "Same as above: the classical baseline is extremely strong.",
    "Same honest caveat."],
  ["q-weather", "Quantum Weather Optimisation", "quantum", "contract", "Research funding", "Met services, energy traders", 5,
    "ERA5, forecast ensembles (free)", "Quantum optimisation, ML",
    "Ensemble selection is combinatorial and genuinely hard.",
    "Weather modelling is dominated by national centres with supercomputers.",
    "Research only."],
  ["q-traffic", "Quantum Space Traffic Optimiser", "quantum", "contract", "£10k–£200k", "Regulators, large operators", 5,
    "Public catalogue, conjunction data (free)", "QUBO, quantum annealing, Python",
    "Collision-avoidance manoeuvre planning across many operators is genuinely combinatorial.",
    "Regulatory, multi-party and safety-critical. Not a starting point.",
    "Genuine long-term fit."],
  ["q-ground-sched", "Quantum Ground Station Scheduler", "quantum", "saas", "£2k–£25k/mo", "Ground networks", 4,
    "Pass windows from TLEs (free)", "QAOA, classical baseline",
    "Small, bounded, and directly comparable against a classical solver.",
    "Classical constraint solvers handle realistic sizes comfortably today.",
    "Good demonstration problem, weak commercial claim."],
  ["q-constellation", "Quantum Constellation Designer", "quantum", "contract", "£20k–£200k", "New constellation operators", 5,
    "Coverage requirements", "Quantum optimisation, coverage simulation",
    "Coverage versus cost is a huge discrete search space.",
    "Very few buyers, each buying once.",
    "Plausible in principle."],
  ["q-route", "Quantum Route Planner for Spacecraft", "quantum", "api", "£5k–£50k", "Mission designers", 5,
    "Ephemerides, delta-v budgets (free)", "Quantum optimisation",
    "Multi-target rendezvous is a travelling-salesman variant — the classic QUBO shape.",
    "Tiny market today.",
    "Genuine fit, distant market."],
  ["q-logistics", "Quantum Lunar Logistics", "quantum", "contract", "Research funding", "Agencies, Artemis suppliers", 5,
    "Mission manifests", "Quantum optimisation",
    "Artemis creates a real future supply-chain problem.",
    "The market does not exist yet.",
    "Long horizon."],

  /* ---------------- D. Ambitious platforms ---------------- */
  ["data-marketplace", "Space Data Marketplace", "platform", "marketplace", "10–20% take", "Data buyers and sellers", 4,
    "Other people's datasets", "Full stack, payments, licensing",
    "Discovery across EO providers is genuinely painful today.",
    "Two-sided cold start, and UP42 and SkyWatch already exist.",
    "No."],
  ["universal-api", "Universal Satellite AI API", "platform", "api", "£0.001–£1 per call", "Developers", 3,
    "Multiple EO sources (free tiers exist)", "FastAPI, model zoo, billing",
    "“Stripe for satellite intelligence” is a real gap, and an API is the most leveraged software shape there is.",
    "You maintain many models at once. Breadth without depth satisfies nobody.",
    "Optional endpoint."],
  ["search-engine", "Space Intelligence Search Engine", "platform", "saas", "£50–£5k/mo", "Analysts, journalists, researchers", 4,
    "Global imagery archive", "Vector search, embeddings, large storage",
    "Natural-language search over Earth is a genuinely compelling product.",
    "Storage and compute at global scale is a well-funded company's problem.",
    "No."],
  ["traffic-platform", "Space Traffic Platform", "platform", "saas", "£1k–£50k/mo", "Operators, insurers, regulators", 3,
    "CelesTrak/Space-Track catalogue (free)", "SGP4, conjunction screening, JS 3D",
    "Beyond Orbit already propagates the live catalogue with SGP4 — the hard half exists.",
    "LeoLabs and COMSPOC are established, with their own sensor networks.",
    "Manoeuvre planning, eventually."],
  ["debris-intel", "Orbital Debris Intelligence", "platform", "saas", "£2k–£40k/mo", "Operators, insurers", 4,
    "Public catalogue plus commercial radar", "SGP4, covariance, probability of collision",
    "Insurers pricing orbital risk need exactly this and largely lack it.",
    "Public TLE accuracy is insufficient for real conjunction assessment; you would need to buy radar data.",
    "Manoeuvre optimisation is a fit."],
  ["space-weather", "Space Weather Platform", "platform", "saas", "£500–£20k/mo", "Operators, grids, aviation", 2,
    "NOAA SWPC and NASA DONKI (free)", "Python, forecasting, alerting",
    "Entirely free data, real operational consequences, and this app already reads the feeds.",
    "NOAA publishes the same warnings free. You must add interpretation specific to a customer's assets.",
    "No."],
  ["orbital-datacenter", "Orbital Data Centre Software", "platform", "contract", "Research funding", "Future orbital compute providers", 5,
    "None yet", "Distributed systems, scheduling",
    "Genuinely novel, and the research literature is opening up.",
    "The hardware does not exist in commercial form yet.",
    "Scheduling fit, far future."],
  ["lunar-mapping", "Lunar Mapping Platform", "platform", "contract", "£10k–£100k", "Agencies, lunar landers", 4,
    "LRO imagery (free, NASA)", "Python, photogrammetry, hazard detection",
    "Free NASA data and a wave of commercial landers needing hazard maps.",
    "Very few customers, all of them sophisticated.",
    "Landing-site selection is a discrete optimisation."],
  ["mars-mapping", "Mars Mapping Platform", "platform", "contract", "Research funding", "Agencies, researchers", 5,
    "HiRISE, CTX (free)", "Python, photogrammetry",
    "Free, magnificent data.",
    "No commercial buyers whatsoever.",
    "No."],
  ["q-cloud", "Quantum Space Optimisation Cloud", "platform", "api", "£1k–£50k", "Anyone with a space optimisation problem", 5,
    "Customer problem definitions", "Qiskit/PennyLane, QUBO compiler, classical solvers",
    "The natural endgame if the mission optimiser finds real customers.",
    "You would be reselling IBM and AWS quantum access with a wrapper. The wrapper must be worth something itself.",
    "By definition — but sell the optimisation, not the word quantum."],
];

export const VENTURES = RAW.map(
  ([id, name, category, model, price, buyer, difficulty, data, stack, edge, blockers, quantum], index) => ({
    id,
    rank: index + 1,
    name,
    category,
    model,
    price,
    buyer,
    difficulty,
    data,
    stack,
    edge,
    blockers,
    quantum,
    freeData: /\(free|free\)|free,|Sentinel|NOAA|CelesTrak|NASA|ERA5|Copernicus|TLE|EuroSAT|LRO|HiRISE|MODIS|OSM|GLAD|GEDI/i.test(data),
  })
);

export const CATEGORIES = {
  earth: { label: "Satellite + AI", emoji: "🛰️", note: "Earth observation turned into a decision somebody pays for." },
  ops: { label: "Space operations + AI", emoji: "🧠", note: "Software infrastructure for the people who fly spacecraft." },
  quantum: { label: "Quantum ML + Space", emoji: "⚛️", note: "Optimisation and classification, with a classical baseline beside it." },
  platform: { label: "Ambitious platforms", emoji: "🌌", note: "Bigger companies. Harder starts." },
};

/* ==================================================================
   Scoring
   ================================================================== */

/**
 * Ranks ideas by how cheaply and quickly *you* can test them.
 *
 * This deliberately rewards free data and skills already present in
 * this repository, and penalises difficulty. It is a prioritisation
 * aid, not a valuation: it says what to try first, never what will
 * succeed.
 */
export function score(venture, { skills = ["python", "javascript", "php", "ml", "js"], preferQuantum = false } = {}) {
  let value = 0;
  const why = [];

  if (venture.freeData) {
    value += 30;
    why.push("Free data: you can build and validate at zero data cost.");
  } else {
    why.push("Needs paid data before a demo is credible.");
  }

  value += (6 - venture.difficulty) * 12;
  why.push(`${DIFFICULTY[venture.difficulty]}.`);

  const stack = venture.stack.toLowerCase();
  const matched = skills.filter((skill) => stack.includes(skill));
  if (matched.length) {
    value += matched.length * 8;
    why.push(`Uses skills you have: ${[...new Set(matched)].join(", ")}.`);
  }

  // Recurring revenue is worth more than transactional for a solo builder.
  if (["saas", "api", "perasset"].includes(venture.model)) {
    value += 12;
    why.push(`${MODELS[venture.model].label}: recurring, so effort compounds.`);
  }

  // Things this repository already implements are cheaper for you specifically.
  const alreadyBuilt = /already|Beyond Orbit/i.test(venture.edge);
  if (alreadyBuilt) {
    value += 25;
    why.push("Beyond Orbit already contains a working part of this.");
  }

  if (preferQuantum && venture.category === "quantum") value += 15;
  if (/^No\.?$/i.test(venture.quantum)) why.push("No honest quantum angle — do not claim one.");

  return { value: Math.max(0, Math.round(value)), why, alreadyBuilt, matched: [...new Set(matched)] };
}

export function ranked(options) {
  return VENTURES.map((venture) => ({ ...venture, ...score(venture, options) })).sort(
    (a, b) => b.value - a.value || a.difficulty - b.difficulty
  );
}

export const byId = (id) => VENTURES.find((v) => v.id === id) || null;

/* ==================================================================
   Turning an idea into a plan
   ================================================================== */

/**
 * The first week of work, written so it can be started immediately.
 *
 * Every plan ends at a *validation* step rather than a launch step,
 * because the expensive mistake is building for six months before
 * discovering nobody wanted it.
 */
export function buildPlan(venture) {
  const v = typeof venture === "string" ? byId(venture) : venture;
  if (!v) return null;

  const dataStep = v.freeData
    ? `Pull one real sample from the free source (${v.data}). One area, one month, downloaded and opened.`
    : `Find the cheapest route to one real sample of ${v.data}. Trial and academic access first — do not sign a data contract yet.`;

  return {
    venture: v.id,
    name: v.name,
    steps: [
      { n: 1, title: "Write the sentence somebody pays for", detail: `One line: “${v.buyer} pay us because ___.” If you cannot finish it, the idea is not ready.` },
      { n: 2, title: "Get one real sample of the data", detail: dataStep },
      { n: 3, title: "Build the ugliest possible version", detail: `A script that turns that sample into the one output ${v.buyer.split(",")[0]} would act on. No interface, no accounts.` },
      { n: 4, title: "Show it to five real buyers", detail: `Five conversations with ${v.buyer}. Not a survey — a demo, and the question “what would have to be true for you to pay ${v.price}?”` },
      { n: 5, title: "Only then build the product", detail: "Dashboard, accounts, billing. Beyond Orbit already gives you auth, a database, scheduling and an approval inbox to start from." },
      { n: 6, title: "Face the blocker deliberately", detail: v.blockers },
    ],
    pricing: MODELS[v.model],
    quantum: v.quantum,
    stack: v.stack,
  };
}

/** Counts for the console header. */
export function stats() {
  const byCategory = {};
  for (const v of VENTURES) byCategory[v.category] = (byCategory[v.category] || 0) + 1;
  return {
    total: VENTURES.length,
    byCategory,
    freeData: VENTURES.filter((v) => v.freeData).length,
    startable: VENTURES.filter((v) => v.difficulty <= 2).length,
    quantumHonest: VENTURES.filter((v) => !/^No\.?$/i.test(v.quantum)).length,
  };
}

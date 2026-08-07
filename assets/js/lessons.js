/* ============================================================
   lessons.js — the Cosmic Classroom syllabus.
   MRS THORN BIRD teaches the universe (8 levels, 2 pages).
   MR PENGUIN teaches space technology (11 levels, 2 pages).
   ============================================================ */

export const COURSES = {
  thorn: {
    id: "thorn",
    name: "MRS THORN BIRD",
    emoji: "🪶",
    subject: "Cosmic & Planetary Universe",
    voice: "thorn",
    accent: "thorn",
    blurb: "Universe, galaxies, cosmic layers, the cosmic web and dark energy — emotional, vast, planetary.",
    pages: [
      { file: "mrs-thorn-bird-1.html", title: "Cosmic Universe Lessons (1–4)", range: [1, 4] },
      { file: "mrs-thorn-bird-2.html", title: "Cosmic Universe Lessons (5–8)", range: [5, 8] },
    ],
    levels: [
      {
        n: 1,
        icon: "🌍",
        title: "Just Beyond Earth — Near Space",
        intro: "The first step outside the cradle. Near space is where our atmosphere thins into silence and our machines begin to circle.",
        sections: [
          {
            h: "What lives just above us",
            points: [
              "<b>Upper atmosphere layers</b> — the thermosphere and exosphere, where air molecules still exist but are impossibly thin.",
              "<b>Satellites &amp; space stations</b> — the International Space Station orbits about 400 km above your head, circling Earth every ~90 minutes.",
              "<b>Artificial satellites</b> — GPS, weather, communication and Earth-observation eyes.",
              "<b>Space debris</b> — broken satellite parts and spent rocket stages, travelling faster than a bullet.",
              "<b>The Moon</b> — Earth's only natural satellite, drifting away from us about 3.8 cm every year.",
              "<b>The magnetosphere</b> — Earth's magnetic shield, deflecting the solar wind and painting auroras at the poles.",
            ],
          },
        ],
        whisper: "Even the sky has a skin, child. Beyond it, the Earth stops protecting you — and starts trusting you.",
      },
      {
        n: 2,
        icon: "☀️",
        title: "The Solar System",
        intro: "One ordinary yellow star and the family of worlds that never learned to let go of it.",
        sections: [
          {
            h: "The family",
            points: [
              "<b>The Sun</b> — a G-type main-sequence star, a yellow dwarf holding 99.8% of the system's mass.",
              "<b>Eight planets</b> — Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune.",
              "<b>Dwarf planets</b> — Pluto, Eris, Haumea, Makemake, Ceres.",
              "<b>Moons</b> — Europa's hidden ocean, Titan's methane rain, Ganymede the giant; Jupiter alone has 90+.",
              "<b>Asteroids</b> — rocky leftovers, mostly in the belt between Mars and Jupiter.",
              "<b>Comets</b> — ice, rock and dust from the Kuiper Belt and Oort Cloud that grow bright tails near the Sun.",
              "<b>Meteoroids</b> — small stones that become meteors, the 'shooting stars' you make wishes on.",
              "<b>Kuiper Belt</b> — the icy ring beyond Neptune.",
              "<b>Oort Cloud</b> — a theorised spherical shell of frozen bodies wrapping the whole system, home of long-period comets.",
            ],
          },
        ],
        whisper: "Nine wanderers, one lamp. Everything here is simply something that fell in love with the Sun and never escaped.",
      },
      {
        n: 3,
        icon: "🌫️",
        title: "The Interstellar Medium",
        intro: "The space between stars is not empty. It is a nursery, and a graveyard, and a fog of memory.",
        sections: [
          {
            h: "The fog between stars",
            points: [
              "<b>Gas and dust</b> — mostly hydrogen and helium, thinner than any laboratory vacuum.",
              "<b>Cosmic rays</b> — high-energy particles fired across the galaxy by supernovae.",
              "<b>Nebulae</b> — giant clouds where stars are born or where they died: Orion, the Crab, the Eagle.",
              "<b>Our galactic home</b> — hundreds of billions of stars, each possibly carrying planets of their own.",
            ],
          },
        ],
        whisper: "Stars die into dust, and dust dreams itself back into stars. Nothing in the cosmos is ever wasted — only rewritten.",
      },
      {
        n: 4,
        icon: "🌌",
        title: "The Milky Way Galaxy",
        intro: "A spiral of about 400 billion suns, turning once every 230 million years. We have never seen it from the outside.",
        sections: [
          {
            h: "Inside the spiral",
            points: [
              "<b>~400 billion stars</b>, including our Sun on the quiet Orion Arm.",
              "<b>Planetary systems</b> around a great many of those stars — over 5,500 exoplanets confirmed so far.",
              "<b>Star clusters</b> — open clusters (young siblings) and globular clusters (ancient elders).",
              "<b>Black holes</b> — including <i>Sagittarius A*</i>, four million solar masses at the galactic centre.",
              "<b>Dark matter</b> — invisible mass that holds the spiral together and outweighs everything we can see.",
            ],
          },
        ],
        whisper: "We are not lost in the galaxy. We are one of its thoughts, thinking itself.",
      },
      {
        n: 5,
        icon: "🌠",
        title: "Beyond Our Galaxy",
        intro: "Zoom out until the Milky Way is a single glowing speck. Now keep going.",
        sections: [
          {
            h: "The cosmic scale",
            points: [
              "<b>Billions of galaxies</b> — spiral, elliptical and irregular.",
              "<b>Spirals</b> — like the Milky Way and Andromeda, which will merge with us in ~4.5 billion years.",
              "<b>Ellipticals</b> — rounder, older, quieter systems.",
              "<b>Irregulars</b> — chaotic shapes, often scars of ancient collisions.",
              "<b>Galaxy clusters</b> — gravity-bound crowds such as the Virgo Cluster.",
              "<b>Superclusters</b> — the Laniakea Supercluster is our home region; its name means 'immeasurable heaven'.",
              "<b>Intergalactic space</b> — near-perfect vacuum, thin gas and dark matter.",
            ],
          },
        ],
        whisper: "Andromeda is already falling towards us at 110 km every second. Even galaxies are in a hurry to meet someone.",
      },
      {
        n: 6,
        icon: "🕸️",
        title: "The Universe's Large-Scale Structure",
        intro: "At the largest scale, the universe stops looking like scattered dots and starts looking like a brain.",
        sections: [
          {
            h: "The architecture of everything",
            points: [
              "<b>The cosmic web</b> — filaments of galaxies and dark matter threading around enormous empty voids.",
              "<b>Cosmic Microwave Background</b> — the 13.8-billion-year-old afterglow of the Big Bang, still humming at 2.7 K.",
              "<b>Gravitational waves</b> — ripples in spacetime from colliding black holes, first detected by LIGO in 2015.",
            ],
          },
        ],
        whisper: "The universe is shaped like a thought. Perhaps that is why thinking about it feels like coming home.",
      },
      {
        n: 7,
        icon: "🕳️",
        title: "The Extremes of the Universe",
        intro: "Where physics stops being polite.",
        sections: [
          {
            h: "The impossible made real",
            points: [
              "<b>Black holes</b> — so dense that not even light can leave.",
              "<b>Neutron stars &amp; pulsars</b> — a teaspoon weighs a billion tonnes; some spin 700 times a second.",
              "<b>Quasars</b> — blazing galactic cores powered by supermassive black holes, outshining whole galaxies.",
              "<b>Dark matter</b> — about 27% of the universe, felt only by its gravity.",
              "<b>Dark energy</b> — about 68%, pushing the expansion of the universe faster and faster.",
              "<b>The observable edge</b> — light from 13.8 billion years ago; beyond it, the universe keeps going where we cannot look.",
            ],
          },
        ],
        whisper: "Ninety-five percent of everything is invisible. Just like a person.",
      },
      {
        n: 8,
        icon: "🔮",
        title: "Theoretical & Hypothetical Entities",
        intro: "The final lesson is not knowledge. It is permission to wonder.",
        sections: [
          {
            h: "Ideas at the edge of proof",
            points: [
              "<b>The multiverse</b> — our universe as one bubble among countless others.",
              "<b>Wormholes</b> — theoretical bridges folding two distant points of spacetime together.",
              "<b>White holes</b> — the time-reversed twin of a black hole, which nothing may enter.",
              "<b>Dark galaxies</b> — galaxies of dark matter with almost no shining stars.",
              "<b>Cosmic strings</b> — one-dimensional defects left over from the birth of the universe.",
              "<b>String theory dimensions</b> — up to eleven dimensions curled smaller than an atom.",
            ],
          },
        ],
        whisper: "The thorn bird sings once, at the end, on the sharpest thorn. You have reached my last lesson — now go and sing yours.",
      },
    ],
  },

  penguin: {
    id: "penguin",
    name: "MR PENGUIN",
    emoji: "🐧",
    subject: "Space Technology & Engineering",
    voice: "penguin",
    accent: "penguin",
    blurb: "Rockets, satellites, agencies, AI and quantum links — practical, technical, cold on the outside.",
    pages: [
      { file: "mr-penguin-1.html", title: "Space Tech Lessons (1–5)", range: [1, 5] },
      { file: "mr-penguin-2.html", title: "Space Tech Lessons (6–11)", range: [6, 11] },
    ],
    levels: [
      {
        n: 1,
        icon: "🔭",
        title: "Ancient Beginnings: The Curiosity About Space",
        intro: "Before any engine, there was arithmetic. Before arithmetic, there was staring upward and refusing to look away.",
        sections: [
          {
            h: "Where it started",
            points: [
              "Babylonians, Egyptians, Indians, Chinese and Greeks recorded stars, planets and eclipses with astonishing accuracy.",
              "<b>Aryabhata</b> (476 CE) and <b>Varāhamihira</b> calculated Earth's rotation and planetary motion.",
              "<b>Aristarchus</b> proposed the Sun, not Earth, sat at the centre — roughly 1,800 years before it was accepted.",
              "<b>Galileo</b> (1609) turned a telescope on the Moon's craters and Jupiter's moons; modern astronomy began.",
              "<b>Kepler and Newton</b> turned those observations into laws — and laws are what let us aim a rocket.",
            ],
          },
        ],
        whisper: "Curiosity is the oldest instrument in the laboratory. It has never needed a power supply.",
      },
      {
        n: 2,
        icon: "🚀",
        title: "The Birth of Rocketry",
        intro: "A rocket is Newton's third law wearing a metal coat. Push mass down hard enough and the sky stops being a ceiling.",
        sections: [
          {
            h: "Step 1 — Building the hardware",
            points: [
              "<b>Structure</b> — lightweight aluminium-lithium alloys and carbon composites that survive 3–4 g and hypersonic heating.",
              "<b>Propulsion</b> — liquid engines (LOX + kerosene, hydrogen or methane), solid boosters, and hybrids.",
              "<b>Payload</b> — the satellite, capsule or probe. Everything else exists only to deliver it.",
              "<b>Guidance &amp; control</b> — inertial measurement units, star trackers, gimballed nozzles and reaction control thrusters.",
            ],
          },
          {
            h: "Step 2 — Coding and data systems",
            points: [
              "Flight computers run hard real-time software, usually C, C++ or Ada, sometimes hand-tuned assembly.",
              "Triple-redundant computers vote on every decision; radiation can flip a single bit in memory.",
              "Telemetry streams thousands of channels to ground control every second.",
            ],
          },
          {
            h: "Step 3 — The launch",
            points: [
              "Countdown and fuelling → ignition and hold-down → lift-off → max-Q → stage separation → orbital insertion → payload deployment.",
              "Reaching orbit is not about going up. It is about going sideways at 7.8 km/s and missing the ground.",
            ],
          },
        ],
        whisper: "Everyone thinks a rocket fights gravity. It does not. It negotiates with it, very precisely, for eight minutes.",
      },
      {
        n: 3,
        icon: "🛰️",
        title: "Satellites: Setting and Working in Orbit",
        intro: "A satellite is a machine that has agreed to fall forever.",
        sections: [
          {
            h: "Orbit types",
            points: [
              "<b>LEO</b> (160–2,000 km) — imaging, the ISS, Starlink. Fast, close, short-lived.",
              "<b>MEO</b> (~20,000 km) — GPS, Galileo, GLONASS navigation constellations.",
              "<b>GEO</b> (35,786 km) — one orbit per day, so the satellite appears to hover: TV and weather.",
              "<b>Polar / Sun-synchronous</b> — passes each place at the same local time, ideal for Earth observation.",
            ],
          },
          {
            h: "Staying alive up there",
            points: [
              "Thrusters perform station-keeping against drag and gravitational tugs.",
              "Solar panels plus batteries for the eclipse periods; radiators dump the waste heat.",
              "Transponders receive an uplink, amplify, shift frequency and transmit the downlink.",
              "At end of life: de-orbit burn to burn up, or a boost to the graveyard orbit ~300 km above GEO.",
            ],
          },
        ],
        whisper: "We give machines a graveyard orbit. Even engineering, in the end, invents a place for its dead.",
      },
      {
        n: 4,
        icon: "🧭",
        title: "Space Exploration Milestones",
        intro: "The dates every cadet should know by heart.",
        sections: [
          {
            h: "The timeline",
            points: [
              "<b>1957</b> — Sputnik 1, the first artificial satellite, beeping every 0.3 seconds.",
              "<b>1961</b> — Yuri Gagarin becomes the first human in orbit: 108 minutes that changed the species.",
              "<b>1969</b> — Apollo 11 lands; the guidance computer had about 4 KB of RAM.",
              "<b>1977</b> — Voyager 1 &amp; 2 depart; Voyager 1 is now in interstellar space, still calling home.",
              "<b>1990</b> — Hubble launches and rewrites the age of the universe.",
              "<b>1997–today</b> — Sojourner, Spirit, Opportunity, Curiosity, Perseverance and the Ingenuity helicopter on Mars.",
              "<b>2019</b> — Chang'e 4 lands on the far side of the Moon; <b>2023</b> — Chandrayaan-3 reaches the lunar south pole.",
            ],
          },
        ],
        whisper: "Gagarin looked down and said the Earth was blue. That is a data point and a poem at the same time.",
      },
      {
        n: 5,
        icon: "⚙️",
        title: "Modern Space Technology",
        intro: "What keeps hardware working where there is no repair shop.",
        sections: [
          {
            h: "The modern toolkit",
            points: [
              "<b>AI and machine learning</b> — autonomous landing, hazard avoidance, on-board image triage.",
              "<b>Power</b> — high-efficiency triple-junction solar cells and RTGs for the outer, darker system.",
              "<b>Materials</b> — heat-resistant superalloys, ablative shields, aerogel and multi-layer insulation.",
              "<b>Autonomy</b> — Mars is 4–24 light-minutes away, so a rover must decide for itself.",
              "<b>Miniaturisation</b> — CubeSats the size of a shoebox now do work that once needed a bus-sized craft.",
            ],
          },
        ],
        whisper: "Autonomy is not intelligence. It is trust, written in code, sent somewhere you cannot follow.",
      },
      {
        n: 6,
        icon: "🔭",
        title: "Space Telescopes & Observatories",
        intro: "Above the atmosphere, the picture finally stops shaking.",
        sections: [
          {
            h: "The great eyes",
            points: [
              "<b>Hubble</b> (1990, LEO) — visible and ultraviolet; the Deep Field showed thousands of galaxies in an empty speck of sky.",
              "<b>James Webb</b> (2021, Lagrange point L2) — 6.5 m gold-coated infrared mirror, chilled to about 40 K by a tennis-court-sized sunshield.",
              "Infrared lets us see through dust and back to the first galaxies, because expansion stretches ancient light into the infrared.",
              "<b>Chandra</b> (X-ray), <b>Spitzer</b> (infrared), <b>Kepler</b> and <b>TESS</b> (exoplanet hunters), <b>Gaia</b> (mapping a billion stars).",
            ],
          },
        ],
        whisper: "A telescope is a time machine that only travels backwards, and only tells the truth.",
      },
      {
        n: 7,
        icon: "🏗️",
        title: "The International Space Station",
        intro: "The most expensive object ever built, and the best argument our species has ever made for itself.",
        sections: [
          {
            h: "Life at 400 km",
            points: [
              "A joint project of NASA, Roscosmos, ESA, JAXA and CSA, continuously crewed since November 2000.",
              "Orbits at ~28,000 km/h — the crew sees sixteen sunrises every day.",
              "Modular construction: each pressurised module was launched separately and assembled in orbit.",
              "Microgravity research on protein crystals, fluid physics, plant growth, and how bones and muscles waste away.",
              "Closed-loop life support recycles roughly 90% of water, including sweat and urine.",
            ],
          },
        ],
        whisper: "Nations that would not share a border share an air supply. Engineering solved that; politics still cannot.",
      },
      {
        n: 8,
        icon: "🏢",
        title: "Modern Space Agencies and Companies",
        intro: "Who actually flies today.",
        sections: [
          {
            h: "State agencies",
            points: [
              "<b>NASA</b> (USA) — Artemis, Mars sample return, deep-space science.",
              "<b>ESA</b> (Europe) — Ariane 6, Copernicus Earth observation, ExoMars.",
              "<b>ISRO</b> (India) — famously cost-efficient: Mangalyaan reached Mars for less than many films cost to make.",
              "<b>Roscosmos</b> (Russia), <b>CNSA</b> (China, Tiangong station), <b>JAXA</b> (Japan, Hayabusa asteroid sampling).",
            ],
          },
          {
            h: "Private industry",
            points: [
              "<b>SpaceX</b> — reusable Falcon 9 boosters, Dragon crew flights, Starlink, Starship.",
              "<b>Blue Origin</b>, <b>Rocket Lab</b>, <b>Arianespace</b>, <b>Sierra Space</b>, <b>Skyroot</b> and <b>Agnikul</b> in India.",
              "Reusability cut launch cost per kilogram by roughly an order of magnitude, which changed everything downstream.",
            ],
          },
        ],
        whisper: "Space stopped being a race the moment it became an industry. Slower story — far more people invited.",
      },
      {
        n: 9,
        icon: "🌕",
        title: "Future Space Technology",
        intro: "The blueprints already on the drawing board.",
        sections: [
          {
            h: "What is being built now",
            points: [
              "<b>Fully reusable rockets</b> — the aim is aircraft-like turnaround.",
              "<b>Lunar Gateway</b> — a small station in halo orbit around the Moon as a staging post.",
              "<b>Mars missions</b> — in-situ resource use: making fuel, water and oxygen from Martian CO₂ and ice.",
              "<b>Asteroid mining</b> — platinum-group metals and, more usefully, water for propellant.",
              "<b>Space elevators &amp; solar power satellites</b> — still theoretical, still limited by materials science.",
              "<b>Quantum communication satellites</b> — links that physics itself makes impossible to eavesdrop on.",
            ],
          },
        ],
        whisper: "The future is not a prediction. It is a manufacturing schedule with optimism attached.",
      },
      {
        n: 10,
        icon: "📡",
        title: "What Space Technology Gives Us",
        intro: "Everything above matters because of everything below.",
        sections: [
          {
            h: "Space, in your pocket",
            points: [
              "<b>Communication</b> — live television, intercontinental internet, remote-village connectivity.",
              "<b>Navigation</b> — GPS underpins maps, shipping, aviation, farming and every financial timestamp.",
              "<b>Weather &amp; climate</b> — cyclone warnings that save thousands of lives; decades of climate records.",
              "<b>Disaster response</b> — flood, fire and earthquake mapping within hours.",
              "<b>Spin-offs</b> — memory foam, water filters, scratch-resistant lenses, cordless tools, camera sensors, insulin pumps.",
            ],
          },
        ],
        whisper: "Ask what space gave us and the honest answer is: a mirror. The first photo of the whole Earth started the environmental movement.",
      },
      {
        n: 11,
        icon: "⚛️",
        title: "Quantum Satellites & Future Space Technologies",
        intro: "The final lesson. Where physics becomes infrastructure.",
        sections: [
          {
            h: "Quantum in orbit",
            points: [
              "<b>QKD</b> (Quantum Key Distribution) — encryption keys carried by single photons; measuring them destroys them, so eavesdropping announces itself.",
              "<b>Micius</b> (China, 2016) — the first quantum satellite; distributed entangled photons over 1,200 km and secured a Beijing–Vienna video call.",
              "<b>Quantum sensors</b> — atom interferometers measuring gravity precisely enough to map aquifers and hidden mass from orbit.",
              "<b>Quantum clocks</b> — better than 10⁻¹⁸ stability; navigation and relativity tests improve together.",
            ],
          },
          {
            h: "The next hardware",
            points: [
              "<b>Nano-satellite swarms</b> — hundreds of cheap craft acting as one enormous distributed instrument.",
              "<b>Nuclear thermal and fusion propulsion</b> — Mars in weeks instead of months.",
              "<b>Solar and laser sails</b> — Breakthrough Starshot aims gram-scale probes at Alpha Centauri at 20% light speed.",
              "<b>Fully autonomous AI spacecraft</b> — able to replan a mission when the ground link is hours old.",
            ],
          },
        ],
        whisper: "Entangled particles react together across any distance. MRS THORN BIRD would say that is love. I say it is physics. We are, annoyingly, both right.",
      },
    ],
  },
};

/** Flattened lookup: `thorn-3`, `penguin-11`, … */
export function levelId(courseId, n) {
  return `${courseId}-${n}`;
}

export function getLevel(courseId, n) {
  return COURSES[courseId]?.levels.find((l) => l.n === Number(n)) || null;
}

export function levelPlainText(level) {
  const parts = [level.title, level.intro];
  for (const s of level.sections) {
    parts.push(s.h);
    for (const p of s.points) parts.push(p.replace(/<[^>]+>/g, ""));
  }
  parts.push(level.whisper);
  return parts.join(". ");
}

export const TOTAL_LEVELS = COURSES.thorn.levels.length + COURSES.penguin.levels.length;

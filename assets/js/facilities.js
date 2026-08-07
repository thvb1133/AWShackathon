/* ============================================================
   facilities.js — the physical infrastructure of spaceflight.

   Real spaceports, real observatories and real ground-station
   networks, with the coordinates that matter. Latitude decides how
   much free velocity a launch site gets from Earth's rotation, so
   these numbers are not decoration — the mesh calculates with them.
   ============================================================ */

const EQUATORIAL_SPEED_MS = 465.1; // Earth's surface speed at the equator

/** [name, country, lat, lon, operator, what flies from here] */
const SPACEPORT_RAW = [
  ["Cape Canaveral Space Force Station", "USA", 28.49, -80.58, "US Space Force / SpaceX / ULA", "Falcon 9, Falcon Heavy, Vulcan Centaur, Atlas V"],
  ["Kennedy Space Center LC-39A", "USA", 28.61, -80.60, "NASA / SpaceX", "Apollo and Shuttle historically; Falcon Heavy and Crew Dragon today"],
  ["Vandenberg Space Force Base", "USA", 34.74, -120.57, "US Space Force / SpaceX", "Polar and sun-synchronous launches over the Pacific"],
  ["Wallops Flight Facility", "USA", 37.94, -75.47, "NASA / Rocket Lab", "Antares, Electron, sounding rockets"],
  ["Starbase Boca Chica", "USA", 25.99, -97.16, "SpaceX", "Starship and Super Heavy test and orbital flights"],
  ["Kodiak Pacific Spaceport", "USA", 57.44, -152.34, "Alaska Aerospace", "High-inclination and polar small launches"],
  ["Spaceport America", "USA", 32.99, -106.97, "New Mexico / Virgin Galactic", "Suborbital spaceplane operations"],
  ["Guiana Space Centre, Kourou", "France", 5.24, -52.77, "CNES / ESA / Arianespace", "Ariane 6, Vega C — 5° from the equator, the best free boost in the West"],
  ["Baikonur Cosmodrome", "Kazakhstan", 45.96, 63.31, "Roscosmos", "Soyuz crew and Progress cargo; Sputnik and Gagarin flew from here"],
  ["Plesetsk Cosmodrome", "Russia", 62.93, 40.57, "Russian Aerospace Forces", "Military and polar launches — the busiest pad complex in history"],
  ["Vostochny Cosmodrome", "Russia", 51.88, 128.33, "Roscosmos", "Angara and Soyuz-2 from Russian soil"],
  ["Satish Dhawan Space Centre (Sriharikota)", "India", 13.72, 80.23, "ISRO", "PSLV, GSLV, LVM3 — Chandrayaan and Mangalyaan launched here"],
  ["Kulasekarapattinam", "India", 8.36, 78.03, "ISRO", "New small satellite launch complex for SSLV, close to the equator"],
  ["Jiuquan Satellite Launch Center", "China", 40.96, 100.29, "CNSA", "Shenzhou crewed missions and Long March flights"],
  ["Xichang Satellite Launch Center", "China", 28.25, 102.03, "CNSA", "Geostationary and lunar missions including Chang'e"],
  ["Wenchang Space Launch Site", "China", 19.61, 110.95, "CNSA", "Long March 5 heavy lift, Tianhe station modules"],
  ["Taiyuan Satellite Launch Center", "China", 38.85, 111.61, "CNSA", "Sun-synchronous and polar orbits"],
  ["Tanegashima Space Center", "Japan", 30.40, 130.97, "JAXA", "H-IIA and H3 launch vehicles"],
  ["Uchinoura Space Center", "Japan", 31.25, 131.08, "JAXA", "Epsilon solid launcher and scientific missions"],
  ["Naro Space Center", "South Korea", 34.43, 127.54, "KARI", "Nuri (KSLV-II) national launcher"],
  ["Mahia Launch Complex 1", "New Zealand", -39.26, 177.86, "Rocket Lab", "Electron — the world's first fully private orbital launch site"],
  ["Bowen Orbital Spaceport", "Australia", -19.99, 148.24, "Gilmour Space", "Eris hybrid-propulsion launcher"],
  ["Arnhem Space Centre", "Australia", -12.38, 136.82, "Equatorial Launch Australia", "Commercial and NASA sounding rocket campaigns"],
  ["Andøya Spaceport", "Norway", 69.29, 16.02, "Andøya Space", "Isar Aerospace Spectrum; polar orbits from the Arctic"],
  ["SaxaVord Spaceport", "UK", 60.82, -0.77, "SaxaVord / Shetland", "Vertical launch to polar and sun-synchronous orbits"],
  ["Sutherland Spaceport", "UK", 58.52, -4.02, "Orbex", "Prime bio-propane micro-launcher"],
  ["Esrange Space Center", "Sweden", 67.89, 21.10, "SSC", "Sounding rockets, balloons and future orbital launch"],
  ["El Arenosillo (CEDEA)", "Spain", 37.10, -6.74, "INTA / PLD Space", "Miura suborbital test flights"],
  ["Alcântara Launch Center", "Brazil", -2.37, -44.40, "Brazilian Space Agency", "Only 2° from the equator — among the best launch latitudes on Earth"],
  ["Palmachim Airbase", "Israel", 31.90, 34.69, "Israel Space Agency", "Shavit — launches westward against Earth's rotation for safety"],
  ["Semnan Space Center", "Iran", 35.23, 53.92, "Iranian Space Agency", "Safir and Simorgh launchers"],
  ["Sohae Satellite Launching Station", "North Korea", 39.66, 124.71, "NADA", "Unha and Chollima launch vehicles"],
  ["Rocket Lab Launch Complex 2", "USA", 37.83, -75.49, "Rocket Lab", "Electron flights from US soil at Wallops"],
  ["Koonibba Test Range", "Australia", -31.90, 133.42, "Southern Launch", "Suborbital test flights over the Great Australian Bight"],
];

export const SPACEPORTS = SPACEPORT_RAW.map(([name, country, lat, lon, operator, flies]) => {
  const boost = EQUATORIAL_SPEED_MS * Math.cos((lat * Math.PI) / 180);
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    name, country, lat, lon, operator, flies,
    /** Free eastward velocity given away by Earth's rotation, in m/s. */
    rotationBoostMs: boost,
    /** Lowest orbital inclination reachable without a costly dogleg. */
    minInclination: Math.abs(lat),
    cat: "spaceport",
  };
});

/** [name, country, lat, lon, aperture/description, what it studies] */
const OBSERVATORY_RAW = [
  ["Very Large Telescope (VLT)", "Chile", -24.63, -70.40, "Four 8.2 m units on Cerro Paranal", "Exoplanets, black hole orbits at the galactic centre"],
  ["Extremely Large Telescope (ELT)", "Chile", -24.59, -70.19, "39 m segmented mirror, first light expected 2029", "Direct imaging of exoplanets and biosignatures"],
  ["Atacama Large Millimeter Array (ALMA)", "Chile", -23.03, -67.75, "66 radio dishes at 5,000 m altitude", "Protoplanetary discs, cold gas, star formation"],
  ["Vera C. Rubin Observatory", "Chile", -30.24, -70.75, "8.4 m survey telescope with a 3.2 gigapixel camera", "A ten-year movie of the entire southern sky"],
  ["Gran Telescopio Canarias", "Spain", 28.76, -17.89, "10.4 m — the largest single optical mirror in operation", "Distant galaxies and faint objects"],
  ["Keck Observatory", "USA", 19.83, -155.47, "Twin 10 m telescopes on Mauna Kea", "Galactic centre stellar orbits, exoplanets"],
  ["Subaru Telescope", "Japan", 19.83, -155.48, "8.2 m with an exceptionally wide field", "Wide-field surveys and weak gravitational lensing"],
  ["Gemini North and South", "USA/Chile", 19.82, -155.47, "Two 8.1 m telescopes covering both hemispheres", "Whole-sky coverage from one programme"],
  ["Green Bank Telescope", "USA", 38.43, -79.84, "100 m steerable radio dish inside a radio-quiet zone", "Pulsars, fast radio bursts, SETI"],
  ["Effelsberg Radio Telescope", "Germany", 50.52, 6.88, "100 m steerable radio dish", "Pulsar timing and VLBI"],
  ["Five-hundred-metre Aperture Spherical Telescope (FAST)", "China", 25.65, 106.86, "500 m fixed radio dish in a natural karst bowl", "Pulsar discovery — hundreds found already"],
  ["Arecibo Observatory (collapsed 2020)", "Puerto Rico", 18.34, -66.75, "305 m dish, lost in December 2020", "Planetary radar, the 1974 Arecibo message"],
  ["MeerKAT", "South Africa", -30.71, 21.44, "64 radio antennas, precursor to the SKA", "Galactic centre imaging, hydrogen surveys"],
  ["Square Kilometre Array (SKA)", "South Africa/Australia", -26.70, 116.63, "Hundreds of thousands of antennas under construction", "The early universe and the epoch of reionisation"],
  ["Event Horizon Telescope", "Global", 19.82, -155.47, "A planet-sized VLBI array of eight or more observatories", "Photographed M87* in 2019 and Sagittarius A* in 2022"],
  ["LIGO Hanford", "USA", 46.46, -119.41, "4 km laser interferometer arms", "Gravitational waves — first detection September 2015"],
  ["LIGO Livingston", "USA", 30.56, -90.77, "4 km laser interferometer arms", "Confirms Hanford detections and localises sources"],
  ["Virgo", "Italy", 43.63, 10.50, "3 km interferometer near Pisa", "Triangulates gravitational wave sources with LIGO"],
  ["KAGRA", "Japan", 36.41, 137.31, "Underground cryogenic interferometer", "Adds a fourth node to the gravitational wave network"],
  ["IceCube Neutrino Observatory", "Antarctica", -89.99, 0.0, "A cubic kilometre of instrumented Antarctic ice", "High-energy cosmic neutrinos"],
  ["Pierre Auger Observatory", "Argentina", -35.21, -69.32, "1,600 detectors over 3,000 km²", "Ultra-high-energy cosmic rays"],
  ["Indian Astronomical Observatory, Hanle", "India", 32.78, 78.96, "2 m optical telescope at 4,500 m — one of the highest on Earth", "Optical and gamma-ray astronomy"],
  ["Giant Metrewave Radio Telescope (GMRT)", "India", 19.09, 74.05, "30 dishes of 45 m each", "Low-frequency radio astronomy and pulsars"],
  ["Mount Wilson Observatory", "USA", 34.22, -118.06, "100-inch Hooker Telescope, 1917", "Where Hubble proved other galaxies exist, in 1924"],
  ["Palomar Observatory", "USA", 33.36, -116.86, "200-inch Hale Telescope and the Zwicky Transient Facility", "Transient surveys, near-Earth object discovery"],
  ["Roque de los Muchachos", "Spain", 28.76, -17.88, "A ridge of telescopes on La Palma", "Optical, gamma-ray and solar astronomy"],
  ["South Pole Telescope", "Antarctica", -89.99, -63.45, "10 m microwave telescope at the geographic South Pole", "Cosmic Microwave Background polarisation"],
  ["Cherenkov Telescope Array", "Spain/Chile", 28.76, -17.89, "Next-generation gamma-ray observatory under construction", "The most energetic processes in the universe"],
  ["Nançay Radio Observatory", "France", 47.38, 2.20, "Decametre and metre-wave arrays", "Pulsars, Jupiter's radio emission"],
  ["Parkes (Murriyang)", "Australia", -32.99, 148.26, "64 m radio dish", "Relayed the Apollo 11 television broadcast; discovered fast radio bursts"],
];

export const OBSERVATORIES = OBSERVATORY_RAW.map(([name, country, lat, lon, spec, studies]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  name, country, lat, lon, spec, studies, cat: "observatory",
}));

/** [network, operator, sites, band coverage, what it is for] */
const GROUND_RAW = [
  ["NASA Deep Space Network", "NASA / JPL", "Goldstone (USA), Madrid (Spain), Canberra (Australia)", "S, X and Ka band", "Commands and receives every NASA deep-space mission, including both Voyagers"],
  ["ESTRACK", "ESA", "Kourou, Cebreros, Malargüe, New Norcia, Redu, Kiruna", "S, X and Ka band", "ESA's deep-space and Earth-orbit tracking backbone"],
  ["ISRO Telemetry, Tracking and Command Network (ISTRAC)", "ISRO", "Bengaluru, Lucknow, Port Blair, Mauritius, Brunei, Biak", "S and X band", "Launch-phase tracking and satellite operations for Indian missions"],
  ["Indian Deep Space Network", "ISRO", "Byalalu, near Bengaluru — 32 m and 18 m dishes", "S and X band", "Chandrayaan and Mangalyaan deep-space communications"],
  ["Chinese Deep Space Network", "CNSA", "Kashgar, Jiamusi, Zapala (Argentina)", "S and X band", "Chang'e lunar and Tianwen Mars missions"],
  ["KSAT Svalbard (SvalSat)", "Kongsberg Satellite Services", "Svalbard, 78°N", "S, X and Ka band", "Sees every polar-orbiting satellite on every single revolution"],
  ["KSAT TrollSat", "Kongsberg Satellite Services", "Troll Station, Antarctica", "S and X band", "The southern counterpart to Svalbard for polar coverage"],
  ["AWS Ground Station", "Amazon Web Services", "Twelve regions worldwide", "S and X band", "Ground segment rented by the minute — no dish of your own required"],
  ["Azure Orbital", "Microsoft", "Partner network of teleports", "S, X and Ka band", "Satellite downlink delivered straight into cloud storage"],
  ["Leaf Space", "Leaf Space (Italy)", "A shared network across Europe, the Azores and New Zealand", "UHF, S and X band", "Ground segment as a service for smallsat operators"],
  ["Universal Space Network / ATLAS", "ATLAS Space Operations", "Distributed commercial antennas", "S and X band", "Software-defined commercial ground network"],
  ["Usuda Deep Space Center", "JAXA", "Nagano, Japan — 64 m dish", "S and X band", "Hayabusa asteroid missions and deep-space science"],
  ["Misasa / Uchinoura Tracking", "JAXA", "Kagoshima, Japan", "S band", "Launch and early-orbit operations for Japanese missions"],
  ["Malindi Space Centre", "Italy (ASI) / Kenya", "Broglio Space Centre, Kenya", "S band", "Equatorial tracking station operating since the 1960s"],
  ["South African National Space Agency ground segment", "SANSA", "Hartebeesthoek", "S, X and Ka band", "Supports launch campaigns and Earth observation across Africa"],
  ["Santiago Satellite Station", "Chile / SSC", "Santiago, Chile", "S and X band", "Southern hemisphere launch and early-orbit support"],
  ["Space Surveillance Network", "US Space Force", "Radars and optical sites worldwide", "Radar and optical", "Maintains the public catalogue of over 30,000 tracked objects"],
  ["LeoLabs radar network", "LeoLabs", "Alaska, Texas, New Zealand, Costa Rica, Azores", "Phased-array radar", "Independent commercial tracking of debris down to 10 cm"],
];

export const GROUND_NETWORKS = GROUND_RAW.map(([name, operator, sites, bands, purpose]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  name, operator, sites, bands, purpose, cat: "ground",
}));

/** Free eastward velocity, in m/s, from launching at a given latitude. */
export const rotationBoost = (latDeg) => EQUATORIAL_SPEED_MS * Math.cos((latDeg * Math.PI) / 180);

export const FACILITY_COUNT = SPACEPORTS.length + OBSERVATORIES.length + GROUND_NETWORKS.length;

// Search query targets for the CA retailer crawler.
// Each query is cross-producted with every retailer in RETAILERS, so the
// target list stays DRY (one entry per model family search). Covers the
// 2025-2026 latest generation plus the previous generation across all 8
// part categories the AIPC catalog uses.

export const RETAILERS = ["newegg", "canadacomputers"];

// Per-retailer search URL builders. Newegg.ca search uses ?d=; CanadaComputers
// uses a keywords= query param. Both are GET requests that return HTML.
export const SEARCH_URL = {
  newegg: (query, page) => {
    const base = `https://www.newegg.ca/p/pl?d=${encodeURIComponent(query)}`;
    return page > 1 ? `${base}&page=${page}` : base;
  },
  canadacomputers: (query, page) => {
    const base = `https://www.canadacomputers.com/search/results_details.php?language=en&keywords=${encodeURIComponent(query)}`;
    return page > 1 ? `${base}&page=${page}` : base;
  },
};

// Robots.txt URL per retailer (fetched once and cached by the crawler).
export const ROBOTS_URL = {
  newegg: "https://www.newegg.ca/robots.txt",
  canadacomputers: "https://www.canadacomputers.com/robots.txt",
};

export const TARGETS = [
  // CPU — Intel Core Ultra 200S (LGA1851), launch + Plus refresh
  { category: "cpu", query: "Core Ultra 9 285K", modelFamily: "arrowlake" },
  { category: "cpu", query: "Core Ultra 9 290K", modelFamily: "arrowlake-refresh" },
  { category: "cpu", query: "Core Ultra 7 265K", modelFamily: "arrowlake" },
  { category: "cpu", query: "Core Ultra 7 270K", modelFamily: "arrowlake-refresh" },
  { category: "cpu", query: "Core Ultra 5 245K", modelFamily: "arrowlake" },
  { category: "cpu", query: "Core Ultra 5 250K", modelFamily: "arrowlake-refresh" },
  { category: "cpu", query: "Core Ultra 5 235", modelFamily: "arrowlake" },
  { category: "cpu", query: "Core Ultra 5 225", modelFamily: "arrowlake" },
  { category: "cpu", query: "Core Ultra 3 205", modelFamily: "arrowlake" },
  // CPU — AMD Ryzen 9000 (AM5), X3D + non-X3D
  { category: "cpu", query: "Ryzen 9 9950X3D", modelFamily: "ryzen9000x3d" },
  { category: "cpu", query: "Ryzen 9 9950X3D2", modelFamily: "ryzen9000x3d" },
  { category: "cpu", query: "Ryzen 9 9900X3D", modelFamily: "ryzen9000x3d" },
  { category: "cpu", query: "Ryzen 9 9950X", modelFamily: "ryzen9000" },
  { category: "cpu", query: "Ryzen 9 9900X", modelFamily: "ryzen9000" },
  { category: "cpu", query: "Ryzen 7 9850X3D", modelFamily: "ryzen9000x3d" },
  { category: "cpu", query: "Ryzen 7 9800X3D", modelFamily: "ryzen9000x3d" },
  { category: "cpu", query: "Ryzen 7 9700X", modelFamily: "ryzen9000" },
  { category: "cpu", query: "Ryzen 5 9600X", modelFamily: "ryzen9000" },
  { category: "cpu", query: "Ryzen 5 9600", modelFamily: "ryzen9000" },
  // CPU — previous generation
  { category: "cpu", query: "Ryzen 7 7800X3D", modelFamily: "ryzen7000x3d" },
  { category: "cpu", query: "Ryzen 7 7700X", modelFamily: "ryzen7000" },
  { category: "cpu", query: "Ryzen 5 7600X", modelFamily: "ryzen7000" },
  { category: "cpu", query: "Core i5-14600K", modelFamily: "raptorlake" },
  { category: "cpu", query: "Core i7-14700K", modelFamily: "raptorlake" },
  { category: "cpu", query: "Core i9-14900K", modelFamily: "raptorlake" },

  // GPU — NVIDIA RTX 50 (Blackwell)
  { category: "gpu", query: "RTX 5090", modelFamily: "blackwell" },
  { category: "gpu", query: "RTX 5080", modelFamily: "blackwell" },
  { category: "gpu", query: "RTX 5070 Ti", modelFamily: "blackwell" },
  { category: "gpu", query: "RTX 5070", modelFamily: "blackwell" },
  { category: "gpu", query: "RTX 5060 Ti", modelFamily: "blackwell" },
  { category: "gpu", query: "RTX 5060", modelFamily: "blackwell" },
  { category: "gpu", query: "RTX 5050", modelFamily: "blackwell" },
  // GPU — AMD RX 9000 (RDNA4)
  { category: "gpu", query: "RX 9070 XT", modelFamily: "rdna4" },
  { category: "gpu", query: "RX 9070", modelFamily: "rdna4" },
  { category: "gpu", query: "RX 9070 GRE", modelFamily: "rdna4" },
  { category: "gpu", query: "RX 9060 XT", modelFamily: "rdna4" },
  { category: "gpu", query: "RX 9060", modelFamily: "rdna4" },
  // GPU — Intel Arc + previous gen
  { category: "gpu", query: "Arc B580", modelFamily: "arc" },
  { category: "gpu", query: "RTX 4090", modelFamily: "ada" },
  { category: "gpu", query: "RTX 4080 Super", modelFamily: "ada" },
  { category: "gpu", query: "RTX 4070 Super", modelFamily: "ada" },
  { category: "gpu", query: "RX 7900 XTX", modelFamily: "rdna3" },
  { category: "gpu", query: "RX 7800 XT", modelFamily: "rdna3" },

  // Motherboard — LGA1851
  { category: "motherboard", query: "Z890", modelFamily: "lga1851" },
  { category: "motherboard", query: "B860", modelFamily: "lga1851" },
  { category: "motherboard", query: "H810", modelFamily: "lga1851" },
  // Motherboard — AM5
  { category: "motherboard", query: "X870", modelFamily: "am5" },
  { category: "motherboard", query: "X870E", modelFamily: "am5" },
  { category: "motherboard", query: "B850", modelFamily: "am5" },
  { category: "motherboard", query: "B840", modelFamily: "am5" },
  // Motherboard — previous gen
  { category: "motherboard", query: "Z790", modelFamily: "lga1700" },
  { category: "motherboard", query: "B760", modelFamily: "lga1700" },
  { category: "motherboard", query: "B650", modelFamily: "am5-prev" },
  { category: "motherboard", query: "X670E", modelFamily: "am5-prev" },

  // RAM
  { category: "ram", query: "DDR5-6000 32GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-6000 64GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-6400 32GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-6400 64GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-7200 32GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-5600 96GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-5600 128GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-6000 16GB", modelFamily: "ddr5" },
  { category: "ram", query: "DDR5-6400 96GB", modelFamily: "ddr5" },

  // Storage
  { category: "storage", query: "Samsung 9100 Pro 2TB", modelFamily: "gen5" },
  { category: "storage", query: "Samsung 9100 Pro 4TB", modelFamily: "gen5" },
  { category: "storage", query: "Crucial T710 2TB", modelFamily: "gen5" },
  { category: "storage", query: "Samsung 990 Pro 2TB", modelFamily: "gen4" },
  { category: "storage", query: "WD SN850X 2TB", modelFamily: "gen4" },
  { category: "storage", query: "Crucial T500 4TB", modelFamily: "gen4" },
  { category: "storage", query: "TeamGroup MP44 2TB", modelFamily: "gen4" },
  { category: "storage", query: "NVMe 4TB PCIe 5", modelFamily: "gen5" },
  { category: "storage", query: "NVMe 8TB", modelFamily: "gen4" },
  { category: "storage", query: "Samsung 990 Pro 1TB", modelFamily: "gen4" },

  // Cooler
  { category: "cooler", query: "Thermalright Peerless Assassin 120", modelFamily: "air" },
  { category: "cooler", query: "Thermalright Phantom Spirit 120", modelFamily: "air" },
  { category: "cooler", query: "Noctua NH-D15 G2", modelFamily: "air" },
  { category: "cooler", query: "Arctic Liquid Freezer III 240", modelFamily: "aio" },
  { category: "cooler", query: "Arctic Liquid Freezer III 360", modelFamily: "aio" },
  { category: "cooler", query: "Arctic Liquid Freezer III Pro 360", modelFamily: "aio" },
  { category: "cooler", query: "Lian Li Galahad II Trinity 360", modelFamily: "aio" },
  { category: "cooler", query: "Corsair NAUTILUS 360", modelFamily: "aio" },
  { category: "cooler", query: "AIO 280mm liquid cooler", modelFamily: "aio" },
  { category: "cooler", query: "AIO 420mm liquid cooler", modelFamily: "aio" },

  // PSU
  { category: "psu", query: "Corsair RM850e", modelFamily: "atx" },
  { category: "psu", query: "Corsair RM1000x", modelFamily: "atx" },
  { category: "psu", query: "Seasonic Focus GX-850", modelFamily: "atx" },
  { category: "psu", query: "Seasonic Vertex PX-1200", modelFamily: "atx" },
  { category: "psu", query: "be quiet Dark Power 13 1200W", modelFamily: "atx" },
  { category: "psu", query: "Corsair SF750", modelFamily: "sfx" },
  { category: "psu", query: "Corsair SF1000", modelFamily: "sfx" },
  { category: "psu", query: "Thermaltake Toughpower GF3 1200W", modelFamily: "atx" },
  { category: "psu", query: "ATX 3.1 1000W Gold modular", modelFamily: "atx" },
  { category: "psu", query: "SFX 850 Platinum modular", modelFamily: "sfx" },

  // Case
  { category: "case", query: "Fractal North", modelFamily: "atx" },
  { category: "case", query: "Fractal North XL", modelFamily: "atx" },
  { category: "case", query: "Fractal Terra", modelFamily: "itx" },
  { category: "case", query: "Corsair 4000D Airflow", modelFamily: "atx" },
  { category: "case", query: "Corsair 3500X", modelFamily: "atx" },
  { category: "case", query: "NZXT H5 Flow", modelFamily: "atx" },
  { category: "case", query: "NZXT H6 Flow RGB", modelFamily: "atx" },
  { category: "case", query: "NZXT H9 Flow", modelFamily: "atx" },
  { category: "case", query: "Lian Li O11 Dynamic EVO", modelFamily: "atx" },
  { category: "case", query: "Lian Li O11D EVO RGB", modelFamily: "atx" },
  { category: "case", query: "Cooler Master NR200P", modelFamily: "itx" },
];

// Category definitions mirroring scripts/crawl-parts.mjs so normalize.mjs
// can reuse the same mapping shape.
export const CATEGORY_DEFS = [
  { app: "cpu", array: "cpus", ctor: "cpu" },
  { app: "gpu", array: "gpus", ctor: "gpu" },
  { app: "motherboard", array: "motherboards", ctor: "mb" },
  { app: "ram", array: "rams", ctor: "ram" },
  { app: "storage", array: "storages", ctor: "storage" },
  { app: "cooler", array: "coolers", ctor: "cooler" },
  { app: "psu", array: "psus", ctor: "psu" },
  { app: "case", array: "cases", ctor: "pcCase" },
];

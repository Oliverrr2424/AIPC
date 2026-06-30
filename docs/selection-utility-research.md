# AIPC whole-build selection research and utility design

Date: 2026-06-30  
Scope: evidence-backed rules for PC-part compatibility, market selection, and whole-build utility. This document intentionally separates facts that can be enforced from heuristics that must remain soft or unknown.

## Executive conclusions

1. Hardware brand is not a sufficient utility feature. Score the workload-relevant capability first, then add narrowly scoped ecosystem or architecture features.
2. AMD 3D V-Cache is a strong gaming feature, especially for CPU-limited and high-refresh workloads. Its utility must diminish when resolution and GPU load make the GPU the binding constraint.
3. Intel hybrid CPUs can be strong in threaded and mixed workloads, but there is no defensible global rule that "Intel wins productivity". Compilation, rendering, media, simulation, and interactive work need separate evidence or proxy features.
4. NVIDIA has a broad software-ecosystem advantage for CUDA-dependent AI, OptiX rendering, and NVENC workflows. AMD remains a valid raster/value or explicitly supported HIP/ROCm option; ROCm support must be checked against the exact GPU, OS, and framework rather than inferred from the AMD brand.
5. DDR generation, IC vendor, and headline MT/s do not by themselves establish stability or durability. QVL validation, CPU memory-controller limits, DIMM count/rank, profile type, voltage, BIOS support, and exact kit part number are stronger signals.
6. SSD quality is model- and workload-specific. TLC/QLC, DRAM/HMB, controller/firmware, sustained write, TBW, warranty, and thermal behavior matter. QLC is not an automatic rejection, but it should not receive the same write-heavy utility as a verified high-end TLC drive without evidence.
7. Missing compatibility facts must produce `UNKNOWN`, never an optimistic `PASS`. An unknown may remain selectable when no fully verified option exists, but it receives a confidence penalty and is surfaced to the user.
8. Budget is a hard feasibility constraint. Among feasible builds, utility uses workload weights and diminishing returns; near-equivalent builds should prefer lower cost and higher evidence/market confidence.

## Evidence and implementation rules

### CPU and gaming

AMD documents a 64 MB stacked L3 cache die in its second-generation 3D V-Cache design and positions the technology specifically around gaming. AMD's 9800X3D launch material reports an average gaming gain over the prior generation under its test suite. Independent original benchmark suites from GamersNexus and TechSpot also show that the benefit is workload-dependent rather than a universal application uplift.

Implementation:

- Add an `x3d` gaming bonus only when the CPU name/tags identify 3D V-Cache.
- Make the bonus largest for 1080p/1440p and 144/240 Hz targets.
- Reduce it materially at 4K, where GPU performance normally dominates.
- Do not add the same bonus to general productivity.
- For mixed gaming + productivity, prefer high-core X3D parts only when their measured productivity capability and budget justify them; do not assume every X3D SKU behaves like an eight-core gaming-only SKU.
- CPU gaming benefit saturates after the target tier is met. Extra CPU score must not displace a GPU upgrade when the GPU remains below the requested FPS tier.

Sources:

- AMD 3D V-Cache technology: https://www.amd.com/en/products/processors/technologies/3d-v-cache.html
- AMD Ryzen 7 9800X3D launch and methodology: https://www.amd.com/en/newsroom/press-releases/2024-10-31-the-gaming-legend-continues--amd-introduces-next-.html
- GamersNexus 9950X3D original benchmark suite: https://gamersnexus.net/cpus/amd-ryzen-9-9950x3d-cpu-review-benchmarks-vs-9800x3d-285k-9950x-more
- TechSpot 9800X3D original benchmark suite: https://www.techspot.com/review/2915-amd-ryzen-7-9800x3d/

### CPU and productivity

Intel documents P-core/E-core hybrid architecture and Thread Director as mechanisms for distributing work, with OS enablement required. That supports a multitasking/threaded-workload feature, not a blanket brand preference. Original current-generation benchmark suites show wins and losses by application and also show high-core AMD parts competing strongly in productivity.

Implementation:

- Do not give Intel or AMD a generic productivity brand bonus.
- Use measured `productivityScore`, cores/threads, power, and workload-specific evidence.
- Development/compilation utility weights CPU and RAM more heavily than GPU.
- Video utility may add a small ecosystem/media feature only when the exact encoder capability is known.
- Interactive development saturates earlier than large compilation/rendering; high core counts earn less after the request's workload target is met.
- If per-application benchmark evidence is unavailable, expose reduced confidence rather than inventing an application win.

Sources:

- Intel hybrid architecture and Thread Director: https://www.intel.com/content/www/us/en/gaming/resources/how-hybrid-design-works.html
- Intel Core Ultra desktop product brief: https://www.intel.com/content/www/us/en/products/docs/processors/core-ultra/core-ultra-desktop-processors-series-2-brief.html
- GamersNexus 9950X3D benchmark suite above.

### GPU gaming, AI, rendering, and video

Blender officially supports NVIDIA CUDA/OptiX, AMD HIP, and Intel oneAPI, but the supported hardware, OS, minimum driver, ray-tracing, and denoising capabilities differ. AMD's ROCm documentation publishes exact GPU/OS/framework matrices and limitations. NVIDIA publishes CUDA platform requirements and NVENC/NVDEC capabilities, including hardware codec support and binary compatibility guarantees for the API.

Implementation:

- Gaming: use resolution-specific raster scores without a blanket NVIDIA brand bonus. Price/value may allow AMD to win.
- AI with explicit CUDA: NVIDIA/CUDA is a hard constraint.
- AI without explicit CUDA: NVIDIA gets a bounded ecosystem-confidence bonus; AMD receives a smaller score only if the exact GPU/OS/framework combination is known to be supported. Unknown ROCm support is not treated as supported.
- Blender/rendering: score measured rendering evidence first; OptiX/HIP/oneAPI is an ecosystem feature, not a substitute for benchmark data.
- Video: add encoder value only when codec and generation are known. Do not infer AV1/10-bit capability solely from brand.
- VRAM target is a hard floor only when explicitly required; otherwise VRAM utility saturates at the workload target.

Sources:

- Blender Cycles GPU rendering support: https://docs.blender.org/manual/en/latest/render/cycles/gpu_rendering.html
- Current ROCm Radeon compatibility hub: https://rocm.docs.amd.com/projects/radeon/en/latest/docs/compatibility.html
- ROCm limitations: https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/limitations/limitationsrad.html
- CUDA installation/system requirements: https://docs.nvidia.com/cuda/cuda-installation-guide-linux/index.html
- NVIDIA NVENC programming guide: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html

### Memory performance and stability

Intel describes XMP as memory overclocking beyond standard settings and warns that changing frequency/voltage can reduce stability and component life. ASUS describes CPU and memory QVLs as combinations validated for compatibility/stability and notes that BIOS updates can be required. Micron documents DDR5 architectural benefits, but those benefits do not establish the stability of a particular kit at a particular profile.

Implementation:

- Memory type, capacity, stick count, motherboard slot count, maximum capacity, and QVL status are compatibility inputs.
- Capacity has strong diminishing returns: default targets are 32 GB gaming/balanced, 64 GB development/video/AI, overridden by explicit user requirements.
- Two-DIMM kits receive a modest stability/upgradeability preference over four-DIMM kits at the same capacity and speed.
- Speeds beyond a conservative platform target add little utility and may add a stability penalty unless QVL/profile evidence is present.
- `XMP`/`EXPO`, voltage, rank, IC type, and QVL must be optional structured fields. If absent, the system must not claim that a kit is especially stable or durable.
- Do not rank Hynix/Samsung/Micron ICs by supposed durability without model-level endurance evidence. IC information can later inform overclocking likelihood, not a hard reliability rule.

Sources:

- Intel XMP description and stability/warranty cautions: https://www.intel.com/content/www/us/en/gaming/extreme-memory-profile-xmp.html
- ASUS CPU/memory QVL guidance: https://www.asus.com/support/FAQ/1043883
- Micron DDR5 module features white paper: https://www.micron.com/content/dam/micron/global/public/products/white-paper/ddr5-key-module-features-wp-client.pdf

### SSD performance, endurance, and workload fit

Micron documents the density/endurance/performance trade-offs among NAND types and notes that controller firmware, ECC, bad-block management, and wear leveling are part of the result. Samsung's 990 Pro specification publishes TLC, DRAM, TBW, and warranty together, which is a better model-level reliability signal than sequential read speed alone. Recent QLC designs can outperform older value TLC products in some client workloads, so NAND type is a prior, not a verdict.

Implementation:

- Add optional `nandType`, `hasDram`, `tbw`, `warrantyYears`, and `sustainedWriteMb` fields.
- Gaming/general use: capacity saturates at the requested target; high sequential speed above a good Gen4 tier adds little practical utility.
- Video, scratch, dataset, and heavy development workloads: weight sustained write, TBW, DRAM/controller evidence, and capacity more heavily.
- QLC receives no blanket fail. It receives a write-heavy penalty only when stronger endurance/sustained-write evidence is absent.
- Missing NAND/endurance/cache fields produce neutral-to-lower confidence, not an invented reliability claim.

Sources:

- Micron NAND selection guide: https://www.micron.com/products/storage/nand-flash/choosing-the-right-nand
- Micron SSD/QLC overview: https://www.micron.com/about/micron-glossary/solid-state-drives
- Micron Adaptive Write Technology brief: https://assets.micron.com/adobe/assets/urn:aaid:aem:c394eee1-4e22-4dac-bd16-d7cc528574e0/renditions/original/as/micron-awt-tech-brief.pdf
- Samsung 990 Pro model specifications: https://news.samsung.com/no/samsung-electronics-4tb-ssd-990-pro-serie-gir-ultimat-ytelse-og-kapasitet-for-gamere-og-kreatorer
- Western Digital SN850X data sheet (TLC, TBW, warranty): https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/product/internal-drives/wd-black-ssd/data-sheet-wd-black-sn850x-nvme-ssd.pdf
- Samsung 9100 Pro specifications (TLC, DRAM, TBW, warranty): https://news.samsung.com/us/samsung-announces-9100-pro-series-ssds-with-breakthrough-pcie-5-0-performance/

### Platform and physical compatibility

Socket equality is necessary but not sufficient: motherboard CPU support lists can require a minimum BIOS. PCI-SIG defines 12V-2x6 as the replacement for 12VHPWR in CEM 5.1. Case compatibility also requires radiator support, GPU thickness, and PSU length, not only GPU length and motherboard form factor.

Implementation:

- Add optional CPU family, motherboard supported CPU families/minimum BIOS, RAM slots, GPU slot thickness/power connector, cooler radiator size, PSU length/connectors/ATX version, and case radiator/GPU-thickness/PSU-length limits.
- If both sides of a relationship are known, return PASS or FAIL.
- If a required field is missing, return UNKNOWN with a concrete verification instruction.
- Optimizer feasibility rejects FAIL, tolerates UNKNOWN with a confidence penalty, and prefers a verified alternative when utility is otherwise close.
- Compatibility rules must be centralized so initial optimization, follow-up repair, and final reporting cannot drift.

Sources:

- ASUS CPU support and BIOS guidance: https://www.asus.com/us/support/faq/1044348/
- PCI-SIG 12V-2x6 ECN: https://pcisig.com/PCI%20Express/ECN/Base/12V-2x6ConnectorUpdatestoPCIeBase_6.0
- Intel ATX design-guide connector section: https://edc.intel.com/content/www/us/en/design/products-and-solutions/processors-and-chipsets/alder-lake-s/atx12vo-12v-only-desktop-power-supply-design-guide/2.1/pcie-aic-auxiliary-power-connectors/

## Whole-build utility specification

### Category importance by workload

Weights sum to 1.0 and operate across categories, so one point of case utility is no longer equal to one point of GPU utility in a gaming build.

| Use case | CPU | GPU | Motherboard | RAM | Storage | Cooler | PSU | Case |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gaming | 0.18 | 0.43 | 0.08 | 0.06 | 0.07 | 0.05 | 0.07 | 0.06 |
| AI | 0.13 | 0.48 | 0.08 | 0.12 | 0.08 | 0.04 | 0.05 | 0.02 |
| Development | 0.29 | 0.08 | 0.12 | 0.20 | 0.13 | 0.05 | 0.07 | 0.06 |
| Video | 0.22 | 0.29 | 0.08 | 0.12 | 0.13 | 0.05 | 0.06 | 0.05 |
| Balanced | 0.22 | 0.25 | 0.10 | 0.12 | 0.10 | 0.06 | 0.08 | 0.07 |

### Target satisfaction and saturation

- GPU gaming score is converted to target satisfaction using resolution and requested FPS. Known game/FPS benchmark evidence has higher confidence; relative score is a fallback.
- CPU gaming target rises for 144/240 Hz and receives the scoped X3D bonus above.
- RAM and storage capacity use `min(actual / target, 1)` for the main capacity benefit. Small quality features may distinguish options after the target, but capacity itself does not keep increasing utility.
- Cooler utility saturates once it safely covers the selected CPU; excessive thermal rating is not rewarded.
- PSU utility saturates after required wattage and healthy headroom; raw wattage is not a quality score.
- Motherboard expansion utility saturates at workload-relevant M.2/memory targets.

### Goal-gap and bottleneck terms

At complete-build scoring time:

- Penalize gaming builds whose GPU target satisfaction is below the requested FPS tier.
- Penalize CPU/GPU imbalance only when the weaker component is below the target; do not force arbitrary tier matching after the target is met.
- Penalize explicit AI VRAM shortfall as infeasible; soft VRAM targets saturate.
- Add a small verified-compatibility bonus and an UNKNOWN penalty.
- Add a market-confidence term; out-of-stock remains excluded when viable alternatives exist.

### Cost opportunity and near-equivalent builds

Budget remains a hard cap. Price is not rewarded for being close to the cap. Complete builds use a bounded cost-opportunity penalty, stronger when the user asks for value. This prevents a tiny utility increase in RAM, PSU, or storage from consuming hundreds of dollars that could be saved or used at the actual bottleneck.

Selection order:

1. Reject hard-constraint or known compatibility failures.
2. Maximize workload target satisfaction and weighted capability.
3. Apply evidence/market/compatibility confidence.
4. Among near-equivalent builds, choose the lower-cost build.

## Regional market policy

- Retailer-specific catalog entries are eligible only in their market region.
- A Canadian retail crawl must never become a US or China fallback price.
- Global/MSRP/reference entries may fill catalog gaps but carry low price and availability confidence.
- A current regional retailer price can be used even when historical snapshots are unavailable, but it remains `availability: unknown` unless stock was explicitly captured.
- Build output reports live regional, regional-catalog fallback, and global-reference counts separately.

## Explicit non-rules

The following statements must not be hard-coded:

- "Intel is always better for productivity."
- "AMD is always better for gaming."
- "NVIDIA is always faster than AMD."
- "Hynix/Samsung/Micron memory ICs are always more durable."
- "TLC is always better than QLC."
- "A socket match guarantees CPU support."
- "Any AIO fits any case."
- "Higher PSU wattage is always better."

These can be evaluated only through workload-specific evidence and exact model attributes.

## Implementation status (2026-06-30)

- `utilityModel.ts` implements workload category weights, arbitrary FPS targets, 3D V-Cache high-refresh scaling, GPU ecosystem features, RAM/storage saturation, compatibility confidence, bounded power headroom, and cost opportunity.
- `compatibilityChecker.ts` is the shared source for full and partial known-failure checks and reports missing CPU-QVL/BIOS, memory QVL, DIMM slots, GPU thickness/connectors, radiator fit, and PSU length as `UNKNOWN`.
- Regional retailer rows are isolated by `marketRegions`; CA-only rows cannot enter US or China builds. Price output distinguishes live, regional-catalog, and global-reference sources.
- Fourteen structurally contradictory derived legacy CPU rows are quarantined from automatic recommendation rather than trusting their fallback socket fields.
- Five new evidence chunks from this research were embedded into the local RAG index. Keyword fallback remains allowed and is reported when the embedding service degrades.
- Current catalog coverage is deliberately incomplete for exact QVL and physical dimensions. For example, exact RAM-to-board QVL coverage is currently zero, so those combinations report `UNKNOWN`; no code path upgrades absent data to `PASS`.
- Regression coverage includes value 1440p gaming, arbitrary 4K/165 Hz targets, CUDA/32 GB VRAM AI, 64 GB development, SFF/air cooling, infeasible budgets, regional isolation, unknown radiator data, and multi-part follow-up repair.

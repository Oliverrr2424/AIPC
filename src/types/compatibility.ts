export type CompatibilityStatus = "PASS"|"WARNING"|"FAIL";
export interface CompatibilityResult { id:string; status:CompatibilityStatus; rule:string; message:string; relatedParts:string[] }

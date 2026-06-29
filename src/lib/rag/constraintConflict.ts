import type { PartCategory } from "@/types/parts";

export interface ConflictingConstraint {
  target: string;
  value: string;
  sourceText?: string;
}

export interface CategoryConflict {
  category: PartCategory;
  constraints: ConflictingConstraint[];
}

/**
 * Thrown when a set of user-stated *required* constraints leaves a part
 * category with no eligible candidate. We deliberately do NOT silently relax
 * hard constraints; instead we surface the minimal set of constraints that
 * jointly have no solution so the caller can ask the user what to relax.
 */
export class ConstraintConflictError extends Error {
  readonly conflicts: CategoryConflict[];

  constructor(conflicts: CategoryConflict[]) {
    super(ConstraintConflictError.describe(conflicts));
    this.name = "ConstraintConflictError";
    this.conflicts = conflicts;
  }

  static describe(conflicts: CategoryConflict[]): string {
    if (!conflicts.length) return "No feasible build satisfies the stated hard constraints.";
    const parts = conflicts.map(conflict => {
      const labels = conflict.constraints.map(item => item.sourceText?.trim() || `${item.target}=${item.value}`);
      const unique = [...new Set(labels)];
      return `${conflict.category}: ${unique.join(" + ")}`;
    });
    return `These required constraints have no joint solution, so no part was silently substituted. Please relax one of them — ${parts.join("; ")}.`;
  }
}

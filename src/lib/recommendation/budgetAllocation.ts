import type { PartCategory } from "@/types/parts";
import type { UseCase } from "@/types/build";
type Allocation=Record<PartCategory,number>;
export const allocations:Record<UseCase,Allocation>={
 gaming:{cpu:.18,gpu:.43,motherboard:.09,ram:.07,storage:.07,cooler:.04,psu:.06,case:.06},
 ai:{cpu:.14,gpu:.50,motherboard:.09,ram:.09,storage:.07,cooler:.04,psu:.04,case:.03},
 development:{cpu:.25,gpu:.16,motherboard:.11,ram:.15,storage:.13,cooler:.06,psu:.07,case:.07},
 video:{cpu:.23,gpu:.29,motherboard:.09,ram:.11,storage:.11,cooler:.05,psu:.06,case:.06},
 balanced:{cpu:.20,gpu:.32,motherboard:.10,ram:.10,storage:.09,cooler:.05,psu:.07,case:.07}
};

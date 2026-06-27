import type { Currency, Part } from "@/types/parts";
export const USD_TO_CAD=1.37;
export const USD_TO_CNY=7.25;
export function priceIn(part:Part,currency:Currency){return Math.round(part.price*(currency==="CAD"?USD_TO_CAD:currency==="CNY"?USD_TO_CNY:1));}
export function formatPrice(value:number,currency:Currency){return new Intl.NumberFormat(currency==="CAD"?"en-CA":currency==="CNY"?"zh-CN":"en-US",{style:"currency",currency,maximumFractionDigits:0}).format(value)}

import { NextResponse } from "next/server";
import { generateBuild } from "@/lib/recommendation/buildGenerator";
import type { BuildRequest } from "@/types/build";
export async function POST(req:Request){try{const input=await req.json() as BuildRequest;if(!input.budget||input.budget<700)return NextResponse.json({error:"Budget must be at least 700."},{status:400});return NextResponse.json(await generateBuild(input))}catch{return NextResponse.json({error:"Unable to generate a build."},{status:500})}}

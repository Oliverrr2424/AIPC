import type { Metadata } from "next";
import { RagChat } from "@/components/build/RagChat";
import { RagChatIntro } from "@/components/build/RagChatIntro";

export const metadata: Metadata = { title: "RAG PC Builder", description: "Describe a PC in natural language and inspect the retrieved evidence behind every recommendation." };

export default function RagBuilderPage() {
  return <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
    <RagChatIntro/>
    <RagChat/>
  </div>;
}

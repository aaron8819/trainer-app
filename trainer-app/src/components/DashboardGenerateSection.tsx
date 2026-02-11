"use client";

import { GenerateFromTemplateCard } from "./GenerateFromTemplateCard";

type TemplateSummary = {
  id: string;
  name: string;
  exerciseCount: number;
  score?: number;
  scoreLabel?: string;
};

type DashboardGenerateSectionProps = {
  templates: TemplateSummary[];
};

export function DashboardGenerateSection({ templates }: DashboardGenerateSectionProps) {
  return (
    <GenerateFromTemplateCard templates={templates} />
  );
}

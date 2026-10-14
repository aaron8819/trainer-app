import type { ReactNode } from 'react';

export function TrainingHomeFrame({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-[#f6f5f1] text-[#171a18]">
    <div className="mx-auto max-w-[1064px] space-y-5 px-[14px] py-5 min-[350px]:px-5 sm:px-7">
      <p className="text-2xl font-bold tracking-tight md:hidden">Trainer
        <span className="ml-1 align-top text-sm font-normal">2</span>
      </p>
      {children}
    </div>
  </main>;
}

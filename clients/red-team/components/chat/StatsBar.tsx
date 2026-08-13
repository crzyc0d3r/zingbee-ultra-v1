"use client";

interface StatsBarProps {
  factsState: { taught: number; assessed: number; mastered: number };
  totalFacts: number;
  tokenCount: number;
  questionsAsked: number;
  correctAnswers: number;
}

export function StatsBar({
  factsState,
  totalFacts,
  tokenCount,
  questionsAsked,
  correctAnswers,
}: StatsBarProps) {
  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-value" id="knowledgePoints">
          {factsState.taught}/{totalFacts}
        </div>
        <div className="stat-label">Taught</div>
      </div>
      <div className="stat">
        <div className="stat-value assessed" id="factsAssessed">
          {factsState.assessed}/{totalFacts}
        </div>
        <div className="stat-label">Assessed</div>
      </div>
      <div className="stat">
        <div className="stat-value mastered" id="factsMastered">
          {factsState.mastered}/{totalFacts}
        </div>
        <div className="stat-label">Mastered</div>
      </div>
      <div className="stat">
        <div className="stat-value" id="tokenCount">
          {tokenCount}
        </div>
        <div className="stat-label">Tokens</div>
      </div>
      <div className="stat">
        <div className="stat-value" id="questionCount">
          {correctAnswers}/{questionsAsked}
        </div>
        <div className="stat-label">Correct</div>
      </div>
    </div>
  );
}

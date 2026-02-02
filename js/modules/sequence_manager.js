export class SequenceManager {
    constructor(steps) {
        this.steps = steps;
        this.currentStepIndex = 0;
        this.results = [];
        this.active = false;
    }

    start() {
        this.active = true;
        this.currentStepIndex = 0;
        this.results = [];
        return this.currentStep();
    }

    currentStep() {
        return this.steps[this.currentStepIndex] ?? null;
    }

    record(score) {
        const step = this.currentStep();
        if (!step) return;
        this.results[this.currentStepIndex] = {
            id: step.id,
            name: step.name,
            score
        };
    }

    next() {
        if (this.currentStepIndex >= this.steps.length - 1) {
            this.active = false;
            return null;
        }
        this.currentStepIndex += 1;
        return this.currentStep();
    }

    retry() {
        return this.currentStep();
    }

    cancel() {
        this.active = false;
        this.currentStepIndex = 0;
        this.results = [];
    }

    totalScore() {
        return this.results.reduce((sum, r) => sum + (Number(r?.score) || 0), 0);
    }
}

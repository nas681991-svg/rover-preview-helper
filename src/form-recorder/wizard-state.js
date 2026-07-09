/**
 * Wizard State Machine (Stage 4)
 * Tracks multi-page navigation and conditional field dependencies.
 */

export class WizardState {
  constructor() {
    this.currentPage = 0;
    this.navActions = [];
    this.lastInteraction = null; // { fieldKey: string, value: string, timestamp: number }
  }

  reset() {
    this.currentPage = 0;
    this.navActions = [];
    this.lastInteraction = null;
  }

  /**
   * Called when a user interacts with a field.
   */
  recordInteraction(key, value) {
    this.lastInteraction = { fieldKey: key, value, timestamp: Date.now() };
  }

  /**
   * Called when a user clicks a navigation button.
   */
  recordNavigation(navAction) {
    this.navActions.push({
      ...navAction,
      page: this.currentPage,
      type: '__NAV__',
      timestamp: Date.now(),
    });
    this.currentPage++;
  }

  /**
   * Called when new fields appear in the DOM.
   * Checks if they might be conditionally dependent on the last interaction.
   */
  checkDependencies(newFields) {
    const deps = [];
    // If fields appeared within 2 seconds of an interaction, assume they are dependent.
    if (this.lastInteraction && (Date.now() - this.lastInteraction.timestamp < 2000)) {
      for (const field of newFields) {
        deps.push({
          dependentField: field.key,
          dependsOn: {
            field: this.lastInteraction.fieldKey,
            operator: 'equals',
            value: this.lastInteraction.value
          }
        });
      }
    }
    return deps;
  }

  getState() {
    return {
      currentPage: this.currentPage,
      navActions: this.navActions,
    };
  }
}

// Singleton instance for the content script
export const wizardState = new WizardState();

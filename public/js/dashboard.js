/**
 * Dashboard Client-Side JavaScript
 *
 * Handles interactive elements:
 * - Bookmark toggle (AJAX)
 * - Settings modal
 * - Slider value display
 */

(function () {
  'use strict';

  // =============================================================================
  // Settings Modal
  // =============================================================================

  const settingsButton = document.getElementById('settings-button');
  const adjustThresholdsBtn = document.getElementById('adjust-thresholds-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeModalButton = document.getElementById('close-modal');
  const cancelSettingsButton = document.getElementById('cancel-settings');
  const settingsForm = document.getElementById('settings-form');
  const scoreThresholdSlider = document.getElementById('score-threshold');
  const scoreThresholdValue = document.getElementById('score-threshold-value');

  /**
   * Open the settings modal
   */
  function openSettingsModal() {
    if (settingsModal) {
      settingsModal.hidden = false;
      document.body.style.overflow = 'hidden';
    }
  }

  /**
   * Close the settings modal
   */
  function closeSettingsModal() {
    if (settingsModal) {
      settingsModal.hidden = true;
      document.body.style.overflow = '';
    }
  }

  // Settings button click
  if (settingsButton) {
    settingsButton.addEventListener('click', openSettingsModal);
  }

  // Adjust thresholds button (in empty state)
  if (adjustThresholdsBtn) {
    adjustThresholdsBtn.addEventListener('click', openSettingsModal);
  }

  // Close modal button
  if (closeModalButton) {
    closeModalButton.addEventListener('click', closeSettingsModal);
  }

  // Cancel button
  if (cancelSettingsButton) {
    cancelSettingsButton.addEventListener('click', closeSettingsModal);
  }

  // Close modal when clicking overlay
  if (settingsModal) {
    settingsModal.addEventListener('click', function (e) {
      if (e.target === settingsModal) {
        closeSettingsModal();
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && settingsModal && !settingsModal.hidden) {
      closeSettingsModal();
    }
  });

  // Update slider value display
  if (scoreThresholdSlider && scoreThresholdValue) {
    scoreThresholdSlider.addEventListener('input', function () {
      scoreThresholdValue.textContent = this.value;
    });
  }

  // Settings form submission
  if (settingsForm) {
    settingsForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const formData = new FormData(settingsForm);
      const data = {
        min_score_threshold: parseInt(formData.get('min_score_threshold'), 10),
        min_complaint_count: parseInt(formData.get('min_complaint_count'), 10),
      };

      const saveButton = settingsForm.querySelector('.button-save');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
      }

      try {
        const response = await fetch('/api/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error('Failed to save settings');
        }

        // Refresh the page to apply new settings
        window.location.reload();
      } catch (error) {
        console.error('Error saving settings:', error);
        alert('Failed to save settings. Please try again.');

        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = 'Save Changes';
        }
      }
    });
  }

  // =============================================================================
  // Bookmark Toggle
  // =============================================================================

  /**
   * Toggle bookmark status for an opportunity
   * @param {string} id - Opportunity ID
   * @param {boolean} isBookmarked - New bookmark status
   */
  async function toggleBookmark(id, isBookmarked) {
    // Find all bookmark buttons for this opportunity (list and detail views)
    const buttons = document.querySelectorAll(`[data-id="${id}"].bookmark-button`);

    // Add loading state
    buttons.forEach((button) => {
      button.classList.add('loading');
    });

    try {
      const response = await fetch(`/api/opportunities/${id}/bookmark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isBookmarked }),
      });

      if (!response.ok) {
        throw new Error('Failed to update bookmark');
      }

      const data = await response.json();

      // Update all bookmark buttons for this opportunity
      buttons.forEach((button) => {
        button.classList.remove('loading');
        button.dataset.bookmarked = data.isBookmarked.toString();

        if (data.isBookmarked) {
          button.classList.add('bookmarked');
          button.setAttribute('aria-label', 'Remove bookmark');
        } else {
          button.classList.remove('bookmarked');
          button.setAttribute('aria-label', 'Add bookmark');
        }

        // Update the SVG fill
        const svg = button.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', data.isBookmarked ? 'currentColor' : 'none');
        }

        // Update onclick handler
        button.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          toggleBookmark(id, !data.isBookmarked);
        };
      });
    } catch (error) {
      console.error('Error toggling bookmark:', error);

      // Remove loading state
      buttons.forEach((button) => {
        button.classList.remove('loading');
      });

      alert('Failed to update bookmark. Please try again.');
    }
  }

  // Make toggleBookmark available globally for inline onclick handlers
  window.toggleBookmark = toggleBookmark;

  // Handle bookmark button on detail page (not using inline onclick)
  const detailBookmarkButton = document.getElementById('detail-bookmark');
  if (detailBookmarkButton) {
    detailBookmarkButton.addEventListener('click', function () {
      const id = this.dataset.id;
      const currentlyBookmarked = this.dataset.bookmarked === 'true';
      toggleBookmark(id, !currentlyBookmarked);
    });
  }

  // =============================================================================
  // Prevent card click when clicking bookmark
  // =============================================================================

  // Card clicks should navigate to detail, but bookmark clicks should not
  const cards = document.querySelectorAll('.opportunity-card');
  cards.forEach((card) => {
    const bookmarkButton = card.querySelector('.bookmark-button');
    if (bookmarkButton) {
      bookmarkButton.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    }
  });
})();

/**
 * BigQuery Release Notes Web App - Frontend Controller
 * Built with Plain Vanilla JavaScript
 */

// Global App State
const state = {
    updates: [],         // Raw parsed updates
    selectedIds: new Set(), // IDs of currently selected updates
    currentFilter: 'all',  // Current active category filter
    searchQuery: '',     // Current search term
    lastSource: 'checking', // Source of feed (cache/live)
    activeComposerUpdate: null // Currently editing update in composer
};

// DOM Elements
const elements = {
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    emptyState: document.getElementById('empty-state'),
    feedContainer: document.getElementById('feed-container'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnRetry: document.getElementById('btn-retry'),
    btnResetFilters: document.getElementById('btn-reset-filters'),
    searchInput: document.getElementById('search-input'),
    clearSearch: document.getElementById('clear-search'),
    filterPills: document.getElementById('filter-pills'),
    selectionBar: document.getElementById('selection-bar'),
    selectionCountText: document.getElementById('selection-count-text'),
    btnClearSelection: document.getElementById('btn-clear-selection'),
    btnTweetSelection: document.getElementById('btn-tweet-selection'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    toastContainer: document.getElementById('toast-container'),
    
    // Modal Composer Elements
    tweetModal: document.getElementById('tweet-modal'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCancelTweet: document.getElementById('btn-cancel-tweet'),
    btnPublishTweet: document.getElementById('btn-publish-tweet'),
    composerOriginalText: document.getElementById('composer-original-text'),
    tweetTextarea: document.getElementById('tweet-textarea'),
    charCount: document.getElementById('char-count'),
    charCounter: document.getElementById('char-counter')
};

/* ----------------------------------------------------
   INITIALIZATION
---------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    // Load initial feed
    fetchReleaseNotes(false);
    
    // Register Event Listeners
    elements.btnRefresh.addEventListener('click', () => fetchReleaseNotes(true));
    elements.btnRetry.addEventListener('click', () => fetchReleaseNotes(true));
    elements.btnResetFilters.addEventListener('click', resetAllFilters);
    
    // Search input handlers
    elements.searchInput.addEventListener('input', handleSearchInput);
    elements.clearSearch.addEventListener('click', clearSearchField);
    
    // Filter click handlers
    elements.filterPills.addEventListener('click', handleFilterClick);
    
    // Selection bar handlers
    elements.btnClearSelection.addEventListener('click', clearSelection);
    elements.btnTweetSelection.addEventListener('click', openTweetComposerForSelection);
    
    // Modal Close actions
    elements.btnCloseModal.addEventListener('click', closeTweetModal);
    elements.btnCancelTweet.addEventListener('click', closeTweetModal);
    elements.tweetModal.addEventListener('click', (e) => {
        if (e.target === elements.tweetModal) closeTweetModal();
    });
    
    // Textarea counter
    elements.tweetTextarea.addEventListener('input', updateComposerCounter);
    
    // Hashtag shortcuts in modal
    document.querySelectorAll('.tag-helper').forEach(helper => {
        helper.addEventListener('click', (e) => {
            const tag = e.target.getAttribute('data-tag');
            insertHashtag(tag);
        });
    });
    
    // Publish tweet
    elements.btnPublishTweet.addEventListener('click', publishTweet);
    
    // Initialize Lucide icons
    lucide.createIcons();
});

/* ----------------------------------------------------
   API SERVICE - FETCH DATA
---------------------------------------------------- */
async function fetchReleaseNotes(forceRefresh = false) {
    showLoading(true);
    elements.btnRefresh.classList.add('loading');
    
    try {
        const url = `/api/release-notes${forceRefresh ? '?refresh=true' : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            processFeedData(data.entries, data.source);
            showLoading(false);
            
            if (forceRefresh) {
                showToast('Feed refreshed successfully!', 'success');
            }
        } else {
            throw new Error(data.error || 'Failed parsing feed from server');
        }
    } catch (error) {
        console.error('Error fetching release notes:', error);
        showError(error.message || 'Unable to connect to the feed service.');
    } finally {
        elements.btnRefresh.classList.remove('loading');
    }
}

/* ----------------------------------------------------
   DATA PROCESSING & PARSING
---------------------------------------------------- */
function processFeedData(entries, source) {
    // Clear state
    state.updates = [];
    state.selectedIds.clear();
    
    // Parse entries and break down to individual updates
    entries.forEach(entry => {
        const parsed = parseEntryContent(entry);
        state.updates.push(...parsed);
    });
    
    // Update status bar
    updateStatusBar(source);
    
    // Update category badge counters
    updateFilterCounts();
    
    // Render
    renderFeed();
    updateSelectionBar();
}

/**
 * Parses Atom feed Entry HTML content, splitting on <h3> headers to segment
 * updates into Features, Issues, Changes, etc.
 */
function parseEntryContent(entry) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(entry.content, 'text/html');
    const children = Array.from(doc.body.childNodes);
    
    const updates = [];
    let currentCategory = 'other';
    let currentHtmlNodes = [];
    
    function pushCurrent() {
        if (currentHtmlNodes.length > 0) {
            const container = document.createElement('div');
            currentHtmlNodes.forEach(node => container.appendChild(node.cloneNode(true)));
            
            const contentHtml = container.innerHTML.trim();
            const textOnly = container.textContent.trim()
                .replace(/\s+/g, ' '); // Clean duplicate whitespaces
            
            if (contentHtml && textOnly) {
                updates.push({
                    id: `${entry.id}-${updates.length}`,
                    date: entry.title,
                    timestamp: entry.updated,
                    category: currentCategory,
                    contentHtml: contentHtml,
                    textOnly: textOnly,
                    link: entry.link
                });
            }
            currentHtmlNodes = [];
        }
    }
    
    children.forEach(node => {
        // Look for category headings
        if (node.nodeType === Node.ELEMENT_NODE && ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.tagName)) {
            pushCurrent();
            
            const text = node.textContent.trim().toLowerCase();
            if (text.includes('feature')) {
                currentCategory = 'feature';
            } else if (text.includes('issue') || text.includes('bug') || text.includes('known issue')) {
                currentCategory = 'issue';
            } else if (text.includes('change') || text.includes('changed') || text.includes('update')) {
                currentCategory = 'changed';
            } else {
                currentCategory = 'other';
            }
        } else {
            currentHtmlNodes.push(node);
        }
    });
    
    // Push final segment
    pushCurrent();
    
    // Fallback: If no headers were detected, bundle whole description
    if (updates.length === 0 && entry.content.trim()) {
        const textOnly = doc.body.textContent.trim().replace(/\s+/g, ' ');
        updates.push({
            id: `${entry.id}-0`,
            date: entry.title,
            timestamp: entry.updated,
            category: 'other',
            contentHtml: entry.content,
            textOnly: textOnly,
            link: entry.link
        });
    }
    
    return updates;
}

/* ----------------------------------------------------
   UI STATE MANAGERS (Spinner, Errors, Status)
---------------------------------------------------- */
function showLoading(isLoading) {
    if (isLoading) {
        elements.loadingState.style.display = 'flex';
        elements.errorState.style.display = 'none';
        elements.emptyState.style.display = 'none';
        elements.feedContainer.style.display = 'none';
    } else {
        elements.loadingState.style.display = 'none';
    }
}

function showError(message) {
    elements.loadingState.style.display = 'none';
    elements.emptyState.style.display = 'none';
    elements.feedContainer.style.display = 'none';
    
    elements.errorMessage.textContent = message;
    elements.errorState.style.display = 'flex';
}

function updateStatusBar(source) {
    elements.statusDot.className = 'status-dot';
    elements.statusDot.classList.add('green');
    
    let sourceText = '';
    switch(source) {
        case 'live':
            sourceText = 'Fresh live data fetched';
            break;
        case 'cache':
            sourceText = 'Loaded from local cache';
            break;
        case 'expired_cache_fallback':
            sourceText = 'Live fetch failed, using cache';
            elements.statusDot.className = 'status-dot yellow pulse';
            break;
        default:
            sourceText = 'Connected';
    }
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    elements.statusText.textContent = `${sourceText} (Updated at ${timeStr})`;
}

function updateFilterCounts() {
    const counts = {
        all: state.updates.length,
        feature: 0,
        issue: 0,
        changed: 0,
        other: 0
    };
    
    state.updates.forEach(u => {
        if (counts.hasOwnProperty(u.category)) {
            counts[u.category]++;
        } else {
            counts.other++;
        }
    });
    
    document.getElementById('count-all').textContent = counts.all;
    document.getElementById('count-feature').textContent = counts.feature;
    document.getElementById('count-issue').textContent = counts.issue;
    document.getElementById('count-changed').textContent = counts.changed;
    document.getElementById('count-other').textContent = counts.other;
}

/* ----------------------------------------------------
   FILTERING & SEARCH LOGIC
---------------------------------------------------- */
function handleSearchInput(e) {
    state.searchQuery = e.target.value.toLowerCase().trim();
    
    if (state.searchQuery) {
        elements.clearSearch.style.display = 'block';
    } else {
        elements.clearSearch.style.display = 'none';
    }
    
    renderFeed();
}

function clearSearchField() {
    elements.searchInput.value = '';
    state.searchQuery = '';
    elements.clearSearch.style.display = 'none';
    renderFeed();
}

function handleFilterClick(e) {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    
    // Toggle active classes
    document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
    pill.classList.add('active');
    
    state.currentFilter = pill.getAttribute('data-type');
    renderFeed();
}

function resetAllFilters() {
    clearSearchField();
    
    document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.filter-pill[data-type="all"]').classList.add('active');
    
    state.currentFilter = 'all';
    renderFeed();
}

/* ----------------------------------------------------
   FEED RENDER LOGIC
---------------------------------------------------- */
function getFilteredUpdates() {
    return state.updates.filter(update => {
        // Category Filter
        const matchesCategory = state.currentFilter === 'all' || update.category === state.currentFilter;
        
        // Search Filter
        const matchesSearch = !state.searchQuery || 
            update.textOnly.toLowerCase().includes(state.searchQuery) ||
            update.date.toLowerCase().includes(state.searchQuery) ||
            update.category.toLowerCase().includes(state.searchQuery);
            
        return matchesCategory && matchesSearch;
    });
}

function renderFeed() {
    const filtered = getFilteredUpdates();
    
    // If no elements match
    if (filtered.length === 0) {
        elements.feedContainer.style.display = 'none';
        elements.emptyState.style.display = 'flex';
        return;
    }
    
    elements.emptyState.style.display = 'none';
    elements.feedContainer.style.display = 'flex';
    elements.feedContainer.innerHTML = '';
    
    // Group updates by date
    const grouped = {};
    filtered.forEach(update => {
        if (!grouped[update.date]) {
            grouped[update.date] = [];
        }
        grouped[update.date].push(update);
    });
    
    // Render grouped layout
    for (const [date, updates] of Object.entries(grouped)) {
        const dateGroup = document.createElement('section');
        dateGroup.className = 'date-group';
        
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.innerHTML = `<h2>${date}</h2>`;
        dateGroup.appendChild(dateHeader);
        
        const updatesList = document.createElement('div');
        updatesList.className = 'updates-list';
        
        updates.forEach(update => {
            const card = createUpdateCard(update);
            updatesList.appendChild(card);
        });
        
        dateGroup.appendChild(updatesList);
        elements.feedContainer.appendChild(dateGroup);
    }
    
    // Re-bind Lucide icons for new cards
    lucide.createIcons();
}

function createUpdateCard(update) {
    const isSelected = state.selectedIds.has(update.id);
    
    const card = document.createElement('div');
    card.className = `update-card ${isSelected ? 'selected' : ''}`;
    card.setAttribute('data-id', update.id);
    
    // Determine category styling
    let borderAccent = 'var(--text-muted)';
    if (update.category === 'feature') borderAccent = 'var(--color-feature)';
    else if (update.category === 'issue') borderAccent = 'var(--color-issue)';
    else if (update.category === 'changed') borderAccent = 'var(--color-changed)';
    else if (update.category === 'other') borderAccent = 'var(--color-other)';
    
    card.style.setProperty('--border-accent', borderAccent);
    
    // Format timestamp string
    let relativeTime = '';
    if (update.timestamp) {
        try {
            const updateDate = new Date(update.timestamp);
            relativeTime = updateDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        } catch(e) {}
    }
    
    card.innerHTML = `
        <div class="card-checkbox">
            <i data-lucide="check"></i>
        </div>
        
        <div class="card-header">
            <span class="badge badge-${update.category}">${update.category}</span>
            <span class="card-time">${relativeTime}</span>
        </div>
        
        <div class="card-body">
            ${update.contentHtml}
        </div>
        
        <div class="card-actions">
            <button class="btn-icon btn-card-link" title="Open official documentation" data-link="${update.link}">
                <i data-lucide="external-link"></i>
            </button>
            <button class="btn-icon btn-card-copy" title="Copy to clipboard">
                <i data-lucide="copy"></i>
            </button>
            <button class="btn-icon btn-card-tweet" title="Share on Twitter/X">
                <i data-lucide="twitter"></i>
            </button>
        </div>
    `;
    
    // Card Click -> Toggle Selection (ignoring button clicks)
    card.addEventListener('click', (e) => {
        if (e.target.closest('.card-actions') || e.target.closest('a')) {
            return; // Don't select if they click action buttons or HTML links
        }
        toggleSelection(update.id);
    });
    
    // Actions Event Listeners
    card.querySelector('.btn-card-link').addEventListener('click', (e) => {
        e.stopPropagation();
        const link = e.currentTarget.getAttribute('data-link');
        if (link) window.open(link, '_blank');
    });
    
    card.querySelector('.btn-card-copy').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(update.textOnly, e.currentTarget);
    });
    
    card.querySelector('.btn-card-tweet').addEventListener('click', (e) => {
        e.stopPropagation();
        openTweetComposer(update);
    });
    
    return card;
}

/* ----------------------------------------------------
   SELECTION ENGINE
---------------------------------------------------- */
function toggleSelection(id) {
    if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
    } else {
        state.selectedIds.add(id);
    }
    
    // Update specific card UI
    const card = document.querySelector(`.update-card[data-id="${id}"]`);
    if (card) {
        card.classList.toggle('selected');
    }
    
    updateSelectionBar();
}

function clearSelection() {
    state.selectedIds.clear();
    document.querySelectorAll('.update-card.selected').forEach(card => {
        card.classList.remove('selected');
    });
    updateSelectionBar();
}

function updateSelectionBar() {
    const count = state.selectedIds.size;
    if (count > 0) {
        elements.selectionCountText.textContent = `${count} ${count === 1 ? 'update' : 'updates'} selected`;
        elements.selectionBar.classList.add('show');
    } else {
        elements.selectionBar.classList.remove('show');
    }
}

/* ----------------------------------------------------
   CLIPBOARD ACTION
---------------------------------------------------- */
async function copyToClipboard(text, buttonEl) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', 'success');
        
        // Visual feedback on the button
        const icon = buttonEl.querySelector('i');
        if (icon) {
            const originalIconName = icon.getAttribute('data-lucide');
            icon.setAttribute('data-lucide', 'check');
            buttonEl.style.color = 'var(--color-feature)';
            lucide.createIcons();
            
            setTimeout(() => {
                icon.setAttribute('data-lucide', originalIconName);
                buttonEl.style.color = '';
                lucide.createIcons();
            }, 1500);
        }
    } catch (err) {
        console.error('Failed to copy to clipboard', err);
        showToast('Failed to copy text', 'error');
    }
}

/* ----------------------------------------------------
   TWEET SHARING & MODAL ENGINE
---------------------------------------------------- */
function openTweetComposer(update) {
    state.activeComposerUpdate = update;
    
    // Load text preview
    elements.composerOriginalText.textContent = `"${update.textOnly.substring(0, 150)}${update.textOnly.length > 150 ? '...' : ''}"`;
    
    // Format initial Tweet
    const header = `Google BigQuery ${capitalize(update.category)} (${update.date}):`;
    const tagString = `#BigQuery #GCP`;
    
    // Try to summarize description or fit inside character limit
    // Total character budget: 280
    // Remaining = 280 - (header.length + link.length + hashtags.length + spacing)
    // 280 - (header.length + 23 [t.co links are 23 chars] + tagString.length + 5 spaces)
    const urlPlaceholder = update.link; // Keep full URL for preview, link length on X is 23
    const spacingChars = 4;
    const reservedLength = header.length + 23 + tagString.length + spacingChars;
    const maxDescLength = Math.max(50, 280 - reservedLength);
    
    let desc = update.textOnly;
    if (desc.length > maxDescLength) {
        desc = desc.substring(0, maxDescLength - 3).trim() + '...';
    }
    
    const tweetText = `${header}\n\n"${desc}"\n\n${tagString}\n${urlPlaceholder}`;
    
    elements.tweetTextarea.value = tweetText;
    elements.tweetModal.style.display = 'flex';
    elements.tweetTextarea.focus();
    
    updateComposerCounter();
}

function openTweetComposerForSelection() {
    if (state.selectedIds.size === 0) return;
    
    // Get all selected updates sorted by database presence
    const selectedUpdates = state.updates.filter(u => state.selectedIds.has(u.id));
    
    if (selectedUpdates.length === 1) {
        openTweetComposer(selectedUpdates[0]);
        return;
    }
    
    // Multiple updates selected - compose a summary tweet
    const categories = Array.from(new Set(selectedUpdates.map(u => capitalize(u.category)))).join(', ');
    const dates = Array.from(new Set(selectedUpdates.map(u => u.date))).join(' & ');
    
    let desc = `Checking out multiple updates (${selectedUpdates.length} items) for Google BigQuery.`;
    
    // Bullet points for selected updates
    let bulletPoints = '';
    selectedUpdates.forEach((u, index) => {
        if (bulletPoints.length < 120) {
            const shortText = u.textOnly.length > 40 ? u.textOnly.substring(0, 37) + '...' : u.textOnly;
            bulletPoints += `\n• [${capitalize(u.category)}] ${shortText}`;
        }
    });
    
    const tagString = `#BigQuery #GCP`;
    // We link to the main release notes or the first item
    const link = selectedUpdates[0].link;
    
    const tweetText = `New BigQuery Release updates (${dates}) featuring: ${categories}\n${bulletPoints}\n\n${tagString}\n${link}`;
    
    state.activeComposerUpdate = {
        textOnly: selectedUpdates.map(u => u.textOnly).join('\n---\n'),
        link: link
    };
    
    elements.composerOriginalText.textContent = `Selected ${selectedUpdates.length} updates: ${selectedUpdates.map(u => `[${capitalize(u.category)}] ${u.date}`).join(', ')}`;
    elements.tweetTextarea.value = tweetText;
    elements.tweetModal.style.display = 'flex';
    elements.tweetTextarea.focus();
    
    updateComposerCounter();
}

function closeTweetModal() {
    elements.tweetModal.style.display = 'none';
    state.activeComposerUpdate = null;
}

function updateComposerCounter() {
    const text = elements.tweetTextarea.value;
    
    // Calculate length accounting for Twitter's automatic t.co link shortening (23 characters for any URL)
    // Find all URLs in the tweet
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex) || [];
    
    let textLengthWithoutUrls = text;
    urls.forEach(url => {
        textLengthWithoutUrls = textLengthWithoutUrls.replace(url, '');
    });
    
    // Actual Twitter length = text without URLs + (23 * number of URLs)
    const computedLength = textLengthWithoutUrls.length + (urls.length * 23);
    
    elements.charCount.textContent = computedLength;
    
    elements.charCounter.className = 'character-counter';
    if (computedLength > 280) {
        elements.charCounter.classList.add('exceeded');
    } else if (computedLength > 250) {
        elements.charCounter.classList.add('warning');
    }
}

function insertHashtag(tag) {
    const textarea = elements.tweetTextarea;
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    // Check if tag already exists in tweet
    if (value.includes(tag)) {
        showToast(`Hashtag ${tag} already added`, 'info');
        return;
    }
    
    // Insert at cursor
    textarea.value = value.substring(0, start) + ' ' + tag + ' ' + value.substring(end);
    textarea.focus();
    
    // Adjust cursor position
    const newPos = start + tag.length + 2;
    textarea.setSelectionRange(newPos, newPos);
    
    updateComposerCounter();
}

function publishTweet() {
    const text = elements.tweetTextarea.value;
    
    // Simple length warning check
    // We re-compute length for check
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex) || [];
    let textLengthWithoutUrls = text;
    urls.forEach(url => {
        textLengthWithoutUrls = textLengthWithoutUrls.replace(url, '');
    });
    const computedLength = textLengthWithoutUrls.length + (urls.length * 23);
    
    if (computedLength > 280) {
        if (!confirm(`Your tweet is ${computedLength} characters, which exceeds X/Twitter's 280-character limit. It might get truncated. Do you want to post anyway?`)) {
            return;
        }
    }
    
    // Open Twitter intent
    const encodedText = encodeURIComponent(text);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
    window.open(twitterUrl, '_blank');
    
    closeTweetModal();
    showToast('Redirected to X/Twitter composer!', 'success');
}

/* ----------------------------------------------------
   TOAST NOTIFICATION ENGINE
---------------------------------------------------- */
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    else if (type === 'error') iconName = 'alert-circle';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span class="toast-message">${message}</span>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    // Re-bind Lucide icons for the toast
    lucide.createIcons();
    
    // Trigger transition
    setTimeout(() => {
        toast.classList.add('show');
    }, 50);
    
    // Remove after 3.5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 350);
    }, 3500);
}

/* ----------------------------------------------------
   HELPERS
---------------------------------------------------- */
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

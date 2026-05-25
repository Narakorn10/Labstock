/**
 * Highlights parts of a text that match the search query.
 * @param {string} text - The original text to display
 * @param {string} query - The search string to highlight
 * @returns {Array|string} - React elements with highlights or original text
 */
export const highlightText = (text, query) => {
    if (!query || !text) return text;
    
    const parts = text.toString().split(new RegExp(`(${query})`, 'gi'));
    
    return parts.map((part, i) => 
        part.toLowerCase() === query.toLowerCase() 
            ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark> 
            : part
    );
};
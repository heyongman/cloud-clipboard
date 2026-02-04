export function prettyFileSize(size) {
    let units = ['TB', 'GB', 'MB', 'KB'];
    let unit = 'Bytes';
    while (size >= 1024 && units.length) {
        size /= 1024;
        unit = units.pop();
    };
    return `${Math.floor(100 * size) / 100} ${unit}`;
}

export function percentage(value, decimal = 2) {
    return (value * 100).toFixed(decimal) + '%';
}

export function formatTimestamp(timestamp) {
    let date = new Date(timestamp * 1000);
    return ''
        + date.getFullYear() + '-'
        + (date.getMonth() + 1).toString().padStart(2, 0) + '-'
        + date.getDate().toString().padStart(2, 0) + ' '
        + date.getHours().toString().padStart(2, 0) + ':'
        + date.getMinutes().toString().padStart(2, 0) + ':'
        + date.getSeconds().toString().padStart(2, 0);
};

export async function copyToClipboard(text) {
    // 1. 优先使用 Clipboard API (需要安全上下文)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return { success: true };
        } catch (e) {
            console.warn('Clipboard API failed:', e);
        }
    }

    // 2. Fallback: execCommand (兼容旧浏览器和非安全上下文)
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    try {
        const result = document.execCommand('copy');
        if (result) {
            return { success: true };
        }
    } catch (e) {
        console.warn('execCommand failed:', e);
    } finally {
        document.body.removeChild(textarea);
    }

    // 3. 最终降级：返回失败，由调用方处理（如弹窗显示文本）
    return { success: false, text };
}
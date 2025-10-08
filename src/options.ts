async function getMessages() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['userLanguage'], async (result) => {
            const lang = result.userLanguage || chrome.i18n.getUILanguage().split('-')[0];
            const messagesUrl = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
            try {
                const response = await fetch(messagesUrl);
                const messages = await response.json();
                resolve(messages);
            } catch (error) {
                console.warn(`Could not load messages for language: ${lang}. Falling back to default.`);
                const defaultMessagesUrl = chrome.runtime.getURL(`_locales/en/messages.json`);
                const defaultResponse = await fetch(defaultMessagesUrl);
                const defaultMessages = await defaultResponse.json();
                resolve(defaultMessages);
            }
        });
    });
}

function getMessage(messages: any, key: string, substitutions?: string | string[]): string {
    const messageObj = messages[key];
    if (!messageObj) {
        return key;
    }
    let message = messageObj.message;

    // First, expand named placeholders like $functionName$ to their defined content (usually $1)
    if (messageObj.placeholders) {
        for (const placeholder in messageObj.placeholders) {
            const content = messageObj.placeholders[placeholder].content;
            message = message.replace(new RegExp(`\\$${placeholder}\\$`, 'g'), content);
        }
    }

    // Then, apply positional substitutions like $1, $2, ...
    if (substitutions) {
        if (Array.isArray(substitutions)) {
            for (let i = 0; i < substitutions.length; i++) {
                message = message.replace(new RegExp(`\\$${i + 1}`, 'g'), substitutions[i]);
            }
        } else {
            message = message.replace(/\$1/g, substitutions as string);
        }
    }

    return message;
}


async function localizeHtmlPage() {
    const messages = await getMessages();

    // Localize using data-i18n attribute
    const i18nElements = document.querySelectorAll('[data-i18n]');
    i18nElements.forEach(elem => {
        const messageKey = elem.getAttribute('data-i18n');
        if (messageKey) {
            const message = getMessage(messages, messageKey);
            if (message) {
                elem.innerHTML = message;
            }
        }
    });

    // Localize placeholders
    const i18nPlaceholderElements = document.querySelectorAll('[data-i18n-placeholder]');
    i18nPlaceholderElements.forEach(elem => {
        const messageKey = elem.getAttribute('data-i18n-placeholder');
        if (messageKey) {
            const message = getMessage(messages, messageKey);
            if (message) {
                elem.setAttribute('placeholder', message);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await localizeHtmlPage();

    const languageSelector = document.getElementById('languageSelector') as HTMLSelectElement;
    const functionsList = document.getElementById('functionsList');
    const saveButton = document.getElementById('saveFunction');
    const functionNameInput = document.getElementById('functionName') as HTMLInputElement;
    const functionDescriptionInput = document.getElementById('functionDescription') as HTMLInputElement;
    const functionParamsInput = document.getElementById('functionParams') as HTMLInputElement;
    const functionBodyInput = document.getElementById('functionBody') as HTMLTextAreaElement;

    const addFunctionModal = document.getElementById('addFunctionModal');
    const addFunctionBtn = document.getElementById('addFunctionBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // Set the selector to the saved language
    chrome.storage.local.get(['userLanguage'], (result) => {
        if (result.userLanguage) {
            languageSelector.value = result.userLanguage;
        } else {
            const browserLang = chrome.i18n.getUILanguage().split('-')[0];
            if (['en', 'es'].includes(browserLang)) {
                languageSelector.value = browserLang;
            } else {
                languageSelector.value = 'en'; // default to English
            }
        }
    });

    languageSelector.addEventListener('change', () => {
        const selectedLanguage = languageSelector.value;
        chrome.storage.local.set({ userLanguage: selectedLanguage }, () => {
            console.log(`Language set to ${selectedLanguage}`);
            // Reload the page to apply the new language
            location.reload();
        });
    });


    interface CustomFunctionParam {
        name: string;
        type: string;
    }

    interface CustomFunction {
        name: string;
        description?: string;
        parameters: CustomFunctionParam[];
        body: string;
    }

    function openModal() {
        if (addFunctionModal) addFunctionModal.style.display = 'block';
    }

    function closeModal() {
        if (addFunctionModal) addFunctionModal.style.display = 'none';
        clearForm();
    }

    function clearForm() {
        functionNameInput.value = '';
        functionDescriptionInput.value = '';
        functionParamsInput.value = '';
        functionBodyInput.value = '';
    }

    addFunctionBtn?.addEventListener('click', openModal);
    closeModalBtn?.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target == addFunctionModal) {
            closeModal();
        }
    });

    const messages = await getMessages();

    // Load functions
    function loadFunctions() {
        chrome.storage.local.get(['customFunctions'], (result) => {
            const customFunctions: { [key: string]: CustomFunction } = result.customFunctions || {};
            functionsList!.innerHTML = '';
            if (Object.keys(customFunctions).length === 0) {
                functionsList!.innerHTML = `<p>${getMessage(messages, 'noFunctionsDefined')}</p>`;
                return;
            }
            for (const name in customFunctions) {
                const func = customFunctions[name];
                const item = document.createElement('div');
                item.className = 'function-item';
                item.innerHTML = `
                    <h3>${func.name}</h3>
                    <p>${getMessage(messages, 'descriptionLabel')}${func.description || getMessage(messages, 'notAvailable')}</p>
                    <p>${getMessage(messages, 'parametersLabel')}${func.parameters.map((p: CustomFunctionParam) => `${p.name}:${p.type}`).join(', ') || getMessage(messages, 'none')}</p>
                    <p>${getMessage(messages, 'bodyLabel')}<code>${func.body}</code></p>
                    <button data-name="${func.name}">${getMessage(messages, 'deleteButton')}</button>
                `;
                functionsList!.appendChild(item);
            }
        });
    }

    // Save function
    saveButton!.addEventListener('click', () => {
        const name = functionNameInput.value.trim();
        const description = functionDescriptionInput.value.trim();
        const paramsStr = functionParamsInput.value.trim();
        const body = functionBodyInput.value;

        if (!name || !body) {
            alert(getMessage(messages, 'nameAndBodyRequired'));
            return;
        }

        let parameters: CustomFunctionParam[] = [];
        if (paramsStr) {
            parameters = paramsStr.split(',').map(p => {
                const parts = p.trim().split(':');
                return { name: parts[0], type: parts[1] || 'string' };
            });
        }

        chrome.storage.local.get(['customFunctions'], (result) => {
            const customFunctions: { [key: string]: CustomFunction } = result.customFunctions || {};
            customFunctions[name] = {
                name,
                description,
                parameters,
                body
            };
            chrome.storage.local.set({ customFunctions }, () => {
                alert(getMessage(messages, 'functionSaved'));
                closeModal();
                loadFunctions();
            });
        });
    });

    // Delete function
    functionsList!.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'BUTTON' && target.dataset.name) {
            const nameToDelete = target.dataset.name;
            if (confirm(getMessage(messages, 'confirmDelete', nameToDelete))) {
                chrome.storage.local.get(['customFunctions'], (result) => {
                    const customFunctions: { [key: string]: CustomFunction } = result.customFunctions || {};
                    delete customFunctions[nameToDelete];
                    chrome.storage.local.set({ customFunctions }, () => {
                        alert(getMessage(messages, 'functionDeleted'));
                        loadFunctions();
                    });
                });
            }
        }
    });

    loadFunctions();
});

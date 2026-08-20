// Import dependencies
import { ethers } from 'ethers';
import confetti from 'canvas-confetti';
import { sdk } from '@farcaster/miniapp-sdk';
import { parseRecipients, validateRecipients } from './src/core/parse.js';
import {
    DEFAULT_BURN_ADDRESSES,
    findBurnRecipients,
    burnTotal
} from './src/core/validate.js';
import { extractAddresses, applyFixedAmount, generateRandomDistribution } from './src/core/distribute.js';
import { debounce } from './src/core/debounce.js';
import { describeError } from './src/core/errors.js';
import { createFallbackProvider, readWithFallback } from './src/core/rpc.js';
import { supportsSendCalls, sendCalls, waitForSendCalls } from './src/core/sendCalls.js';

// Initialize Farcaster SDK
sdk.actions.ready({ disableNativeGestures: true });

// Make confetti available globally
window.confetti = confetti;

// --- Lazy AppKit bootstrap -----------------------------------------------
// Reown AppKit + its networks are code-split (see vite.config manualChunks).
// We dynamically import them only when needed and kick the boot off in idle
// time after first paint, so the ~400KB-gzip Reown chunk does not block the
// initial render. If the user clicks Connect first, handleConnect awaits this.
let appKit = null;
let appInitPromise = null;

async function ensureAppKit() {
    if (appInitPromise) return appInitPromise;
    appInitPromise = (async () => {
        const [{ createAppKit }, { EthersAdapter }, nets] = await Promise.all([
            import('@reown/appkit'),
            import('@reown/appkit-adapter-ethers'),
            import('@reown/appkit/networks')
        ]);

        const { mainnet, base, optimism, arbitrum, bsc, avalanche, polygon, defineChain } = nets;
        const litvmLiteForge = defineChain({
            id: 4441,
            caipNetworkId: 'eip155:4441',
            chainNamespace: 'eip155',
            name: 'LitVM LiteForge',
            nativeCurrency: { name: 'zkLTC', symbol: 'zkLTC', decimals: 18 },
            rpcUrls: { default: { http: ['https://liteforge.rpc.caldera.xyz/http'] } },
            blockExplorers: { default: { name: 'LiteForge Explorer', url: 'https://liteforge.explorer.caldera.xyz' } }
        });

        const kit = await createAppKit({
            projectId: '0c80bc29a555c719ed2410c54b52a16d',
            networks: [base, mainnet, optimism, arbitrum, bsc, avalanche, polygon, litvmLiteForge],
            adapters: [new EthersAdapter()],
            metadata: {
                name: 'FarSend',
                description: 'Multi-chain batch send ETH and ERC-20 tokens',
                url: 'https://farsend.vercel.app',
                icons: ['https://farsend.vercel.app/icon.png']
            },
            defaultNetwork: base,
            // Feature Base Account (the smart wallet behind the Base App) so it
            // appears first in the wallet modal, while keeping all other wallets.
            featuredWalletIds: [BASE_ACCOUNT_WALLET_ID],
            allWallets: 'SHOW',
            features: { socials: false, email: false },
            themeMode: 'dark'
        });

        appKit = kit;
        window.appKit = kit;
        console.log('✅ Reown AppKit initialized successfully');
        return kit;
    })();
    return appInitPromise;
}

// Boot the app (initializeApp wires the provider subscriber + listeners).
async function bootApp() {
    try {
        await ensureAppKit();
        initializeApp();
    } catch (error) {
        console.error('❌ Failed to initialize AppKit:', error);
        document.getElementById('connectWalletBtn').innerHTML = '<span style="color: red;">Error: Failed to load wallet connector. Please refresh.</span>';
    }
}

// Base Account (the passkey ERC-4337 smart wallet powering the Base App) is a
// registered Reown wallet. Featuring its wallet ID surfaces it first in the
// AppKit modal; it connects through the same ethers adapter, so the batch-send
// flow (disperseEther/disperseToken via signer.sendTransaction) works unchanged.
export const BASE_ACCOUNT_WALLET_ID =
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa';

// Comma-separated fallback public RPCs per chain (see src/core/rpc.js).
// NOTE: keep EXPECTED_CHAIN_IDS in scripts/check-chains.mjs in sync if you add
// networks here — see the drift guard there.

// Defer the heavy chunk until after first paint (idle time).
if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => bootApp(), { timeout: 1500 });
} else {
    setTimeout(bootApp, 300);
}

function initializeApp() {
    // --- CONSTANTS & CONFIGURATION ---

    // Maximum recipients allowed in a single batch (safety cap)
    const MAX_RECIPIENTS = 500;
    const BURN_ADDRESSES = DEFAULT_BURN_ADDRESSES;

    // Load chains config
    let CHAINS_CONFIG = {};
    let CONTRACT_ABI = [];

    fetch('/chains.json')
        .then(res => res.json())
        .then(config => {
            CHAINS_CONFIG = config.chains;
            CONTRACT_ABI = config.abi;
            console.log('✅ Loaded chains configuration:', Object.keys(CHAINS_CONFIG));

            // Validate configuration
            if (!CHAINS_CONFIG || Object.keys(CHAINS_CONFIG).length === 0) {
                throw new Error('Empty chain configuration');
            }

            Object.entries(CHAINS_CONFIG).forEach(([chainId, chain]) => {
                if (!chain.name || !chain.contractAddress || !chain.rpcUrl) {
                    throw new Error(`Invalid chain configuration for chain ${chainId}: missing required properties`);
                }
                if (!ethers.isAddress(chain.contractAddress)) {
                    throw new Error(`Invalid contract address for chain ${chainId}: ${chain.contractAddress}`);
                }
            });

            console.log('Chain configuration validated successfully');
            populateChainSelector();
            updateChainDisplay(8453); // Set Base as default UI
        })
        .catch(e => {
            console.error('❌ Failed loading chains.json:', e);
            showNotification('Failed to load chain configuration. Please refresh the page.', 'error');
        });

    const ERC20_ABI = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address owner) view returns (uint256)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
    ];

    // --- DOM Elements ---
    const connectWalletBtn = document.getElementById('connectWalletBtn');
    const baseAccountBtn = document.getElementById('baseAccountBtn');
    const appContent = document.getElementById('app-content');
    const chainSelector = document.getElementById('chainSelector');
    chainSelector.disabled = true; // Disabled until wallet connects
    const tokenSelect = document.getElementById('tokenSelect');
    const erc20InputContainer = document.getElementById('erc20InputContainer');
    const erc20Address = document.getElementById('erc20Address');
    const tokenSymbolDisplay = document.getElementById('tokenSymbolDisplay');
    const recipientsTextarea = document.getElementById('recipients');
    const bulkAmountInput = document.getElementById('bulkAmount');
    const applyBulkAmountBtn = document.getElementById('applyBulkAmountBtn');

    // New Distribution Tool Elements
    const setFixedModeBtn = document.getElementById('setFixedMode');
    const setRandomModeBtn = document.getElementById('setRandomMode');
    const fixedModePanel = document.getElementById('fixedModePanel');
    const randomModePanel = document.getElementById('randomModePanel');
    const randomTotalInput = document.getElementById('randomTotal');
    const randomMinInput = document.getElementById('randomMin');
    const randomMaxInput = document.getElementById('randomMax');
    const applyRandomAmountBtn = document.getElementById('applyRandomAmountBtn');
    const csvUpload = document.getElementById('csvUpload');
    const recipientCountEl = document.getElementById('recipientCount');
    const totalAmountEl = document.getElementById('totalAmount');
    const tokenContractDisplay = document.getElementById('tokenContractDisplay');
    const tokenInfoRow = document.getElementById('tokenInfoRow');
    const dispatchBtn = document.getElementById('dispatchBtn');
    const dispatchBtnText = document.getElementById('dispatchBtnText');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const notification = document.getElementById('notification');
    const approvalSection = document.getElementById('approvalSection');
    const approveBtn = document.getElementById('approveBtn');
    const approvalMessage = document.getElementById('approvalMessage');
    const approveAmountEl = document.getElementById('approveAmount');
    const approveSymbolEl = document.getElementById('approveSymbol');
    const burnWarningSection = document.getElementById('burnWarningSection');
    const burnConfirmCheckbox = document.getElementById('burnConfirmCheckbox');
    const burnCountDisplay = document.getElementById('burnCountDisplay');
    const burnAmountDisplay = document.getElementById('burnAmountDisplay');

    // --- APPLICATION STATE ---
    const state = {
        isWalletConnected: false,
        walletAddress: null,
        provider: null,
        signer: null,
        currentChain: null,
        batchContract: null,
        recipients: [],
        token: 'ETH',
        tokenInfo: {
            address: '',
            symbol: 'ETH',
            decimals: 18,
            contract: null,
            allowance: 0n,
            requiredAllowance: 0n,
        },
        currentStep: 1,
        accountsChangedListenerAdded: false,
        eip1193Provider: null,
        burnConfirmed: false,
    };

    // Monotonic token for the async summary/approval path. Every `updateSummary()`
    // call bumps it; stale in-flight results compare their captured token against
    // the latest and abandon the DOM update, preventing interleaving races.
    let summaryGeneration = 0;

    // --- HELPER FUNCTIONS ---

    function populateChainSelector() {
        chainSelector.innerHTML = '<option value="">Select Network</option>';

        Object.entries(CHAINS_CONFIG).forEach(([chainId, chain]) => {
            const option = document.createElement('option');
            option.value = chainId;
            option.textContent = chain.name;
            chainSelector.appendChild(option);
        });
    }

    function updateChainDisplay(chainId) {
        const chain = CHAINS_CONFIG[chainId];
        console.log('updateChainDisplay called with chainId:', chainId, 'chain found:', !!chain);
        if (chain) {
            state.currentChain = chain;
            chainSelector.value = chainId.toString();
            console.log('Updated dropdown to chainId:', chainId, 'current value:', chainSelector.value);

            if (state.signer && CONTRACT_ABI) {
                state.batchContract = new ethers.Contract(
                    chain.contractAddress,
                    CONTRACT_ABI,
                    state.signer
                );
            }

            if (state.token === 'ETH') {
                state.tokenInfo.symbol = chain.nativeCurrency?.symbol || 'ETH';
                state.tokenInfo.decimals = chain.nativeCurrency?.decimals || 18;

                // Update the dropdown option text
                const nativeOption = Array.from(tokenSelect.options).find(opt => opt.value === 'ETH');
                if (nativeOption) {
                    nativeOption.textContent = state.tokenInfo.symbol;
                }
            }

            showNotification(`Network set to ${chain.name}`, 'success');
            updateSummary(); // Refresh summary with new symbol
        } else {
            chainSelector.value = '';
            showNotification('Unsupported network selected', 'error');
        }
    }

    // Fallback read-only provider for the current chain (used when the wallet
    // RPC is flaky). Signing never uses this.
    function fallbackProvider() {
        if (!state.currentChain) return null;
        return createFallbackProvider(state.currentChain);
    }

    function updateBurnWarning() {
        const burnRecipients = findBurnRecipients(state.recipients, BURN_ADDRESSES);
        if (burnRecipients.length > 0) {
            const total = burnTotal(state.recipients, BURN_ADDRESSES);
            burnCountDisplay.textContent = String(burnRecipients.length);
            burnAmountDisplay.textContent = total.toFixed(8);
            burnWarningSection.classList.remove('hidden');
        } else {
            // No burn addresses present: hide the warning and clear the confirmation.
            burnWarningSection.classList.add('hidden');
            burnConfirmCheckbox.checked = false;
            state.burnConfirmed = false;
        }
    }

    // Premium SVG icon set (replaces emoji). Decorative: aria-hidden + focusable=false.
    const NOTIFICATION_ICONS = {
        success: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>`,
        error: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
        info: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
    };

    const NOTIFICATION_STYLES = {
        success: { bg: '#ecfdf5', fg: '#065f46', border: '#34d399', iconBg: 'rgba(16,185,129,0.14)' },
        error: { bg: '#fef2f2', fg: '#991b1b', border: '#f87171', iconBg: 'rgba(239,68,68,0.14)' },
        info: { bg: '#eff6ff', fg: '#1E40AF', border: '#93C5FD', iconBg: 'rgba(59,130,246,0.14)' }
    };

    function showNotification(message, type = 'success') {
        const s = NOTIFICATION_STYLES[type] || NOTIFICATION_STYLES.info;
        notification.innerHTML = `
            <div class="flex items-start gap-3">
                <span class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                    style="background:${s.iconBg}; color:${s.fg};">
                    ${NOTIFICATION_ICONS[type] || NOTIFICATION_ICONS.info}
                </span>
                <div class="flex-1 min-w-0 text-sm leading-snug">${message}</div>
            </div>`;
        notification.className = 'p-3 rounded-xl main-card shadow-lg show';
        notification.style.backgroundColor = s.bg;
        notification.style.color = s.fg;
        notification.style.border = `1px solid ${s.border}`;
        setTimeout(() => notification.classList.remove('show'), 8000);
    }

    function updateStepIndicator(step) {
        state.currentStep = step;
        const steps = [
            { id: 'stepCircle1', labelId: 'stepLabel1', label: 'Connect Wallet' },
            { id: 'stepCircle2', labelId: 'stepLabel2', label: 'Define Recipients' },
            { id: 'stepCircle3', labelId: 'stepLabel3', label: 'Dispatch' }
        ];

        // Checkmark shown on completed steps (premium touch, decorative).
        const CHECK_SVG = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

        steps.forEach((s, index) => {
            const stepEl = document.getElementById(s.id);
            const labelEl = document.getElementById(s.labelId);
            const isActive = (index + 1) === step;
            const isCompleted = (index + 1) < step;

            stepEl.className = 'w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300';
            labelEl.className = 'text-xs mt-2 text-center transition-colors duration-300';

            // Completed steps display a check; active/pending display the step number.
            stepEl.innerHTML = isCompleted ? CHECK_SVG : `<span class="font-bold">${index + 1}</span>`;

            if (isActive) {
                stepEl.style.backgroundColor = '#6A3CFF';
                stepEl.style.color = 'white';
                stepEl.classList.add('ring-4', 'ring-purple-500', 'ring-opacity-50');
                labelEl.classList.add('font-semibold');
                labelEl.style.color = '#6A3CFF';
            } else if (isCompleted) {
                stepEl.style.backgroundColor = 'var(--fc-light-bg)';
                stepEl.style.color = '#6A3CFF';
                stepEl.classList.remove('ring-4', 'ring-purple-500');
                labelEl.style.color = '#582FD6';
                labelEl.classList.add('font-medium');
            } else {
                stepEl.style.backgroundColor = '#E5E7EB';
                stepEl.style.color = '#6B7280';
                stepEl.classList.remove('ring-4', 'ring-purple-500');
                labelEl.style.color = '#6B7280';
                labelEl.classList.remove('font-semibold');
            }
        });
    }

    // --- WEB3 CORE LOGIC ---

    async function handleConnect() {
        const wasConnected = state.isWalletConnected;
        const previousAddress = state.walletAddress;

        connectWalletBtn.disabled = true;
        connectWalletBtn.innerHTML = `<span class="animate-pulse text-purple-700 font-bold">Connecting...</span>`;

        try {
            // Ensure the lazy-loaded AppKit is ready before opening the modal.
            await ensureAppKit();
            await window.appKit.open({ view: 'Connect', namespace: 'eip155' });

            // Wait a bit for state to update via subscribeProviders
            await new Promise(resolve => setTimeout(resolve, 500));

            // If wallet is connected, restore the connected state UI
            if (state.isWalletConnected && state.walletAddress) {
                const truncatedAddress = `${state.walletAddress.slice(0, 6)}...${state.walletAddress.slice(-4)}`;
                connectWalletBtn.innerHTML = `<span>Connected: ${truncatedAddress}</span>`;
                connectWalletBtn.classList.remove('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700');
                connectWalletBtn.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
                connectWalletBtn.disabled = false;
            } else if (!state.isWalletConnected) {
                // Modal was closed or connection failed
                connectWalletBtn.innerHTML = `
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                <span>Connect Wallet</span>`;
                connectWalletBtn.disabled = false;
            }
        } catch (error) {
            console.error('Connection error:', error);
            showNotification(`Wallet connection failed: ${describeError(error, { action: 'connection', fallback: 'please try again.' })}`, 'error');

            // Restore previous state if there was one
            if (wasConnected && previousAddress) {
                const truncatedAddress = `${previousAddress.slice(0, 6)}...${previousAddress.slice(-4)}`;
                connectWalletBtn.innerHTML = `<span>Connected: ${truncatedAddress}</span>`;
                connectWalletBtn.classList.remove('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700');
                connectWalletBtn.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
            } else {
                connectWalletBtn.innerHTML = `
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                <span>Connect Wallet</span>`;
            }
            connectWalletBtn.disabled = false;
        }
    }

    function handleDisconnect() {
        if (state.isWalletConnected) {
            window.appKit.disconnect();
        }

        state.isWalletConnected = false;
        state.walletAddress = null;
        state.signer = null;
        state.currentChain = null;
        state.batchContract = null;
        state.accountsChangedListenerAdded = false;
        state.provider = null;

        state.tokenInfo = { address: '', symbol: 'ETH', decimals: 18, contract: null, allowance: 0n, requiredAllowance: 0n };
        erc20Address.value = '';
        tokenSymbolDisplay.textContent = '';
        approvalSection.classList.add('hidden');

        // Disable chain selector when disconnected
        chainSelector.disabled = true;
        chainSelector.value = '';

        // Stop chain checking
        stopChainCheck();

        connectWalletBtn.innerHTML = `
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                        <span>Connect Wallet</span>`;
        connectWalletBtn.classList.remove('bg-green-500', 'hover:bg-green-600', 'text-white', 'bg-red-500', 'hover:bg-red-600');
        connectWalletBtn.classList.add('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700');
        connectWalletBtn.disabled = false;

        appContent.classList.add('hidden');
        updateStepIndicator(1);
    }

    function handleConnectClick() {
        if (state.isWalletConnected) {
            // If already connected, disconnect the wallet
            handleDisconnect();
        } else {
            // If not connected, initiate connection
            handleConnect();
        }
    }

    // Sign in with Base Account. Base Account is already featured in the AppKit
    // modal via featuredWalletIds, so opening the connect view surfaces it first.
    // If the wallet is already connected this simply opens the modal to switch
    // accounts/wallets.
    async function handleBaseAccountConnect() {
        baseAccountBtn.disabled = true;
        baseAccountBtn.innerHTML = `<span class="animate-pulse text-[#0052FF] font-bold">Connecting with Base...</span>`;

        try {
            await ensureAppKit();
            await window.appKit.open({ view: 'Connect', namespace: 'eip155' });
            await new Promise(resolve => setTimeout(resolve, 500));

            if (state.isWalletConnected && state.walletAddress) {
                const truncatedAddress = `${state.walletAddress.slice(0, 6)}...${state.walletAddress.slice(-4)}`;
                showNotification(`Connected with Base Account: ${truncatedAddress}`, 'success');
            }
        } catch (error) {
            console.error('Base Account connection error:', error);
            showNotification(`Base Account connection failed: ${describeError(error, { action: 'connection', fallback: 'please try again.' })}`, 'error');
        } finally {
            baseAccountBtn.innerHTML = `
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                    <path d="M12 2a8.6 8.6 0 0 1 8.6 8.6c0 .6-.1 1.2-.3 1.8l.7 3.4a1.5 1.5 0 0 1-1.5 1.8H14.9a5.4 5.4 0 0 1-5.3-4.3 2.9 2.9 0 0 1 2.8-3.6 2.8 2.8 0 0 1 2.8 2.9 2.9 2.9 0 0 1-.4 1.5l4.2-1.6a8.6 8.6 0 0 0-7-7.3L12 2zm0 20c-2 0-3.6-.6-4.7-1.7L3 20l.3-4.3A8.6 8.6 0 0 1 12 22zm-2.4-11.5A4.6 4.6 0 0 0 12 6.5a4.6 4.6 0 0 0 2.4 4c-.8-.6-1.3-1.4-1.5-2.3-.2.9-.7 1.7-1.5 2.3z" />
                </svg>
                <span>Sign in with Base Account</span>`;
            baseAccountBtn.disabled = false;
        }
    }

    async function readTokenMetadata(address, provider) {
        const c = new ethers.Contract(address, ERC20_ABI, provider);
        const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
        return { symbol, decimals: Number(decimals) };
    }

    async function validateERC20Address(address) {
        if (!state.provider) {
            showNotification('Please connect your wallet first.', 'error');
            return false;
        }
        const fb = fallbackProvider();
        try {
            const meta = await readWithFallback(
                () => readTokenMetadata(address, state.provider),
                () => readTokenMetadata(address, fb),
                { fallbackProvider: fb }
            );

            // The contract stays bound to the wallet provider — only the metadata
            // read may have used the fallback RPC; money ops still go through signer.
            const tokenContract = new ethers.Contract(address, ERC20_ABI, state.provider);

            state.tokenInfo = {
                address: ethers.getAddress(address),
                symbol: meta.symbol,
                decimals: meta.decimals,
                contract: tokenContract,
                allowance: 0n,
                requiredAllowance: 0n,
            };

            tokenSymbolDisplay.textContent = state.tokenInfo.symbol;
            tokenContractDisplay.textContent = `${state.tokenInfo.address.slice(0, 6)}...${state.tokenInfo.address.slice(-4)}`;
            tokenInfoRow.classList.remove('hidden');
            showNotification(`Token validated: ${state.tokenInfo.symbol} (${state.tokenInfo.decimals} decimals)`, 'success');
            return true;
        } catch (error) {
            console.error('ERC-20 validation failed:', error);
            state.tokenInfo = { address: '', symbol: 'ERC20', decimals: 18, contract: null, allowance: 0n, requiredAllowance: 0n };
            tokenSymbolDisplay.textContent = 'Invalid';
            tokenInfoRow.classList.add('hidden');
            showNotification('Invalid ERC-20 contract address or network error.', 'error');
            return false;
        }
    }

    // Compute the ERC-20 allowance status. Pure-ish: returns a plain object and
    // caches requiredAllowance on tokenInfo; does NOT touch the DOM, so callers
    // can gate the DOM update behind the summary generation token.
    async function computeApproval() {
        const tokenContractWithSigner = state.tokenInfo.contract.connect(state.signer);
        const decimals = state.tokenInfo.decimals;
        const amounts = state.recipients.map(r => {
            try {
                return ethers.parseUnits(r.amount, decimals);
            } catch (e) {
                throw new Error(`Invalid amount format: ${r.amount}`);
            }
        });
        const totalAmountBN = amounts.reduce((sum, amt) => sum + amt, 0n);

        const contractAddress = state.currentChain?.contractAddress;
        const fb = fallbackProvider();
        const allowance = await readWithFallback(
            () => tokenContractWithSigner.allowance(state.walletAddress, contractAddress),
            () => state.tokenInfo.contract.connect(fb).allowance(state.walletAddress, contractAddress),
            { fallbackProvider: fb }
        );

        state.tokenInfo.allowance = allowance;
        state.tokenInfo.requiredAllowance = totalAmountBN;

        return {
            needsApproval: allowance < totalAmountBN,
            requiredFormatted: ethers.formatUnits(totalAmountBN, decimals),
            currentFormatted: ethers.formatUnits(allowance, decimals),
            symbol: state.tokenInfo.symbol,
            decimals
        };
    }

    function applyApprovalUI(a) {
        if (a.needsApproval) {
            approvalMessage.innerHTML = `To send a total of <strong>${a.requiredFormatted} ${a.symbol}</strong>, approve spending. Your current allowance is ${a.currentFormatted} ${a.symbol}.`;
            approveAmountEl.textContent = a.requiredFormatted;
            approveSymbolEl.textContent = a.symbol;
            approvalSection.classList.remove('hidden');
        } else {
            approvalSection.classList.add('hidden');
        }
    }

    async function checkAndPromptApproval() {
        if (state.token !== 'ERC20' || !state.tokenInfo.contract || state.recipients.length === 0) return true;
        try {
            const a = await computeApproval();
            applyApprovalUI(a);
            return !a.needsApproval;
        } catch (error) {
            console.error('Approval check error:', error);
            showNotification(`Failed to check token allowance: ${describeError(error, { action: 'allowance check' })}`, 'error');
            return false;
        }
    }

    async function handleApprove() {
        if (!state.currentChain?.contractAddress) {
            showNotification('Contract address not loaded. Please refresh.', 'error');
            return;
        }
        if (!state.signer) {
            showNotification('Wallet not connected.', 'error');
            return;
        }

        approveBtn.disabled = true;
        approveBtn.textContent = 'Approving...';

        const amountToApprove = state.tokenInfo.requiredAllowance;
        const amountToDisplay = ethers.formatUnits(amountToApprove, state.tokenInfo.decimals);

        try {
            showNotification(`Requesting approval for ${amountToDisplay} ${state.tokenInfo.symbol}...`, 'info');

            const contractWithSigner = state.tokenInfo.contract.connect(state.signer);
            const contractAddress = state.currentChain?.contractAddress;

            // CRITICAL FIX: Add explicit gas limit for Farcaster Wallet
            const gasEstimate = await contractWithSigner.approve.estimateGas(contractAddress, amountToApprove);
            const gasLimit = gasEstimate + (gasEstimate * 20n / 100n); // Add 20% buffer

            const tx = await contractWithSigner.approve(contractAddress, amountToApprove, {
                gasLimit: gasLimit
            });

            const explorerUrl = state.currentChain?.explorerUrl || 'https://etherscan.io';
            showNotification(`Approval transaction sent. Waiting for confirmation: <a href="${explorerUrl}/tx/${tx.hash}" target="_blank" class="font-bold underline" style="color: #582FD6;">View Tx</a>`, 'info');

            await tx.wait();

            showNotification(`Approval confirmed! You can now dispatch the batch.`, 'success');

            state.tokenInfo.allowance = amountToApprove;
            approvalSection.classList.add('hidden');
            await updateSummary();

        } catch (error) {
            console.error('Approval failed:', error);
            showNotification(`Approval failed: ${describeError(error, { abi: CONTRACT_ABI, action: 'approval' })}`, 'error');
        } finally {
            approveBtn.disabled = false;
            const displayAmount = parseFloat(amountToDisplay).toFixed(state.tokenInfo.decimals > 4 ? 4 : state.tokenInfo.decimals);
            approveBtn.innerHTML = `Approve <span id="approveAmount">${displayAmount}</span> <span id="approveSymbol">${state.tokenInfo.symbol}</span>`;
            approveAmountEl.textContent = displayAmount;
            approveSymbolEl.textContent = state.tokenInfo.symbol;
        }
    }

    async function handleDispatch() {
        if (!state.signer) return showNotification('Wallet not connected.', 'error');
        if (!state.batchContract || !state.currentChain?.contractAddress) return showNotification('Batch contract not loaded. Please refresh the page.', 'error');

        dispatchBtn.disabled = true;
        loadingSpinner.classList.remove('hidden');
        dispatchBtnText.textContent = 'Preparing batch...';
        document.getElementById('shieldIcon').classList.add('hidden');

        const { recipients, token, tokenInfo, batchContract, signer, walletAddress } = state;

        try {
            if (recipients.length === 0) throw new Error('No recipients defined');
            if (recipients.length > MAX_RECIPIENTS) throw new Error(`Batch exceeds the ${MAX_RECIPIENTS} recipient safety limit. Please split into smaller batches.`);

            const decimals = token === 'ETH' ? 18 : tokenInfo.decimals;
            const amounts = recipients.map(r => {
                try {
                    return ethers.parseUnits(r.amount, decimals);
                } catch (e) {
                    throw new Error(`Invalid amount format: ${r.amount}`);
                }
            });
            const totalAmountBN = amounts.reduce((sum, amt) => sum + amt, 0n);

            const fb = fallbackProvider();
            if (token === 'ETH') {
                const balance = await readWithFallback(
                    () => state.provider.getBalance(walletAddress),
                    () => fb.getBalance(walletAddress),
                    { fallbackProvider: fb }
                );
                if (totalAmountBN > balance) {
                    const required = ethers.formatEther(totalAmountBN);
                    const available = ethers.formatEther(balance);
                    throw new Error(`Insufficient ETH balance. Required: ${required} ETH, Available: ${available} ETH`);
                }
            } else {
                if (!tokenInfo.contract) throw new Error('Token contract not initialized');
                const tokenContractWithSigner = tokenInfo.contract.connect(signer);
                const contractAddress = state.currentChain?.contractAddress;
                const [balance, allowance] = await readWithFallback(
                    () => Promise.all([
                        tokenContractWithSigner.balanceOf(walletAddress),
                        tokenContractWithSigner.allowance(walletAddress, contractAddress)
                    ]),
                    () => {
                        const c = tokenInfo.contract.connect(fb);
                        return Promise.all([
                            c.balanceOf(walletAddress),
                            c.allowance(walletAddress, contractAddress)
                        ]);
                    },
                    { fallbackProvider: fb }
                );

                if (totalAmountBN > balance) {
                    const required = ethers.formatUnits(totalAmountBN, decimals);
                    const available = ethers.formatUnits(balance, decimals);
                    throw new Error(`Insufficient ${tokenInfo.symbol} balance. Required: ${required}, Available: ${available}`);
                }

                if (allowance < totalAmountBN) {
                    const required = ethers.formatUnits(totalAmountBN, decimals);
                    const avail = ethers.formatUnits(allowance, decimals);
                    throw new Error(`Insufficient allowance for ${tokenInfo.symbol}. Required: ${required}, Current: ${avail}. Please approve.`);
                }
            }

            if (token === 'ERC20') {
                const isApproved = await checkAndPromptApproval();
                if (!isApproved) {
                    throw new Error('Token approval required. Please approve before dispatching.');
                }
            }

            dispatchBtnText.textContent = 'Requesting transaction signature...';
            let tx;
            let txHash = null;
            let usedSmartWallet = false;
            const recipientAddresses = recipients.map(r => r.address);
            const explorerUrl = state.currentChain?.explorerUrl || 'https://etherscan.io';

            // Build the contract call so it can be dispatched either via the smart
            // wallet's wallet_sendCalls (EIP-5792, e.g. Base Account) or via a
            // regular signer.sendTransaction (EOA wallets). Same gas-optimized
            // BatchSender call either way.
            const iface = new ethers.Interface(CONTRACT_ABI);
            const contractAddress = state.currentChain.contractAddress;
            const chainIdHex = state.currentChain.chainIdHex ||
                `0x${state.currentChain.chainId.toString(16)}`;
            const callData = token === 'ETH'
                ? iface.encodeFunctionData('disperseEther', [recipientAddresses, amounts])
                : iface.encodeFunctionData('disperseToken', [tokenInfo.address, recipientAddresses, amounts]);

            // Prefer the EIP-5792 smart-wallet path when available (Base Account,
            // other ERC-4337 wallets). It lets the wallet bundle/sponsor the batch
            // atomically and handles gas estimation internally.
            if (state.eip1193Provider) {
                try {
                    if (await supportsSendCalls(state.eip1193Provider, chainIdHex)) {
                        usedSmartWallet = true;
                        dispatchBtnText.textContent = 'Confirm in your smart wallet...';
                        const batchId = await sendCalls({
                            provider: state.eip1193Provider,
                            from: walletAddress,
                            chainIdHex,
                            calls: [{ to: contractAddress, value: totalAmountBN, data: callData }]
                        });
                        showNotification(`Batch submitted (id ${batchId}). Waiting for confirmation...`, 'info');
                        const result = await waitForSendCalls({
                            provider: state.eip1193Provider,
                            batchId
                        });
                        if (result.status === 'CONFIRMED') {
                            txHash = result.txHashes?.[0] || null;
                        } else if (result.status === 'CANCELLED') {
                            throw Object.assign(new Error('Transaction rejected by user.'), { code: 4001 });
                        } else {
                            throw new Error('Transaction failed on chain. Please check the explorer for details.');
                        }
                    }
                } catch (scError) {
                    // User rejections are always surfaced. Any other failure falls
                    // back to the standard signer path so EOA-style wallets still work.
                    if (scError?.code === 'ACTION_REJECTED' || scError?.code === 4001) throw scError;
                    console.warn('wallet_sendCalls path failed, falling back to standard path:', scError);
                    usedSmartWallet = false;
                    txHash = null;
                }
            }

            // Standard signer path (EOA wallets and smart-wallet fallback).
            if (!usedSmartWallet) {
                if (token === 'ETH') {
                    const totalValue = totalAmountBN;

                    try {
                        // Estimate gas first
                        const gasEstimate = await batchContract.disperseEther.estimateGas(
                            recipientAddresses,
                            amounts,
                            { value: totalValue }
                        );

                        // Add 30% buffer for Farcaster Wallet
                        const gasLimit = gasEstimate + (gasEstimate * 30n / 100n);

                        tx = await batchContract.disperseEther(
                            recipientAddresses,
                            amounts,
                            {
                                value: totalValue,
                                gasLimit: gasLimit
                            }
                        );
                    } catch (estimateError) {
                        console.error('Gas estimation failed:', estimateError);

                        // Never broadcast with a manual gas limit: if estimation failed the
                        // call would likely revert, and broadcasting it would burn the user's
                        // gas (and move the ETH out and back minus fees). Fail safely instead.
                        if (estimateError.code === 'ACTION_REJECTED') {
                            throw estimateError;
                        }
                        throw new Error(`Gas estimation failed — the transaction would likely revert. ${estimateError.reason || estimateError.message}`);
                    }
                } else {
                    const batchContractWithSigner = batchContract.connect(signer);

                    try {
                        // Estimate gas first
                        const gasEstimate = await batchContractWithSigner.disperseToken.estimateGas(
                            tokenInfo.address,
                            recipientAddresses,
                            amounts
                        );

                        // Add 30% buffer for Farcaster Wallet
                        const gasLimit = gasEstimate + (gasEstimate * 30n / 100n);

                        tx = await batchContractWithSigner.disperseToken(
                            tokenInfo.address,
                            recipientAddresses,
                            amounts,
                            {
                                gasLimit: gasLimit
                            }
                        );
                    } catch (estimateError) {
                        console.error('Gas estimation failed:', estimateError);

                        // Never broadcast with a manual gas limit: if estimation failed the
                        // call would likely revert, and broadcasting it would burn the user's gas.
                        if (estimateError.code === 'ACTION_REJECTED') {
                            throw estimateError;
                        }
                        throw new Error(`Gas estimation failed — the transaction would likely revert. ${estimateError.reason || estimateError.message}`);
                    }
                }

                showNotification(`Batch transaction sent! Waiting for confirmation: <a href="${explorerUrl}/tx/${tx.hash}" target="_blank" class="font-bold underline" style="color: #582FD6;">View Tx</a>`, 'info');

                const receipt = await tx.wait();

                if (receipt.status === 1) {
                    txHash = receipt.hash;
                } else {
                    throw new Error('Transaction reverted on chain. Please check the explorer for details.');
                }
            }

            // Shared success handling (works for both dispatch paths).
            if (txHash) {
                const explorerName = state.currentChain?.explorerUrl?.includes('basescan') ? 'BaseScan' :
                    state.currentChain?.explorerUrl?.includes('etherscan') ? 'Etherscan' :
                        state.currentChain?.explorerUrl?.includes('optimistic') ? 'Optimistic Etherscan' :
                            state.currentChain?.explorerUrl?.includes('arbiscan') ? 'Arbiscan' :
                                state.currentChain?.explorerUrl?.includes('bscscan') ? 'BscScan' :
                                    state.currentChain?.explorerUrl?.includes('snowtrace') ? 'Snowtrace' :
                                        state.currentChain?.explorerUrl?.includes('polygonscan') ? 'PolygonScan' : 'Explorer';
                const message = `Batch of ${recipients.length} transfers confirmed.<br>
                                <a href="${explorerUrl}/tx/${txHash}" target="_blank" class="font-bold underline" style="color: #582FD6;">View on ${explorerName}</a>`;
                showNotification(message, 'success');

                if (window.confetti) {
                    window.confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                }

                recipientsTextarea.value = '';
                parseAndValidateData('', 'text');
            }

        } catch (error) {
            console.error('Dispatch error:', error);
            const reason = describeError(error, { abi: CONTRACT_ABI, action: 'transaction' });
            showNotification(`Dispatch failed: ${reason}`, 'error');
        } finally {
            loadingSpinner.classList.add('hidden');
            dispatchBtnText.textContent = 'Dispatch Batch';
            document.getElementById('shieldIcon').classList.remove('hidden');
            await updateSummary();
        }
    }

    function parseAndValidateData(data, type = 'text') {
        const decimals = state.token === 'ETH' ? 18 : state.tokenInfo.decimals;

        const parsed = parseRecipients(data, type);
        if (!parsed.ok) {
            showNotification(parsed.error, 'error');
            return;
        }

        const { recipients, errorCount: validationErrors } = validateRecipients(parsed.entries, decimals);
        const errorCount = parsed.errorCount + validationErrors;

        state.recipients = recipients;

        if (errorCount > 0) {
            showNotification(`Parsed ${state.recipients.length} valid recipients. Ignored ${errorCount} invalid lines (check address format or amounts).`, 'info');
        } else if (state.recipients.length > 0) {
            showNotification(`${state.recipients.length} recipients loaded successfully.`, 'success');
        } else if (data.trim().length > 0) {
            showNotification('No valid recipients found in the data.', 'error');
        }

        updateBurnWarning();
        updateSummary();
        updatePreview();
    }

    async function updateSummary() {
        // Bump the generation token so older in-flight summary calls that resolve
        // later cannot overwrite a newer state (prevents stale dispatchBtn/stepper).
        const gen = ++summaryGeneration;

        const count = state.recipients.length;
        const displayTotal = state.recipients.reduce((sum, item) => sum + parseFloat(item.amount), 0);

        recipientCountEl.textContent = count;
        const tokenSymbol = state.tokenInfo.symbol;
        const decimals = state.tokenInfo.decimals || 18;
        const displayDecimals = Math.min(decimals, 8);
        totalAmountEl.textContent = `${displayTotal.toFixed(displayDecimals)} ${tokenSymbol}`;

        let isReady = false;

        if (count > 0 && displayTotal > 0 && state.isWalletConnected && state.batchContract) {
            if (state.token === 'ERC20') {
                const isValidToken = state.tokenInfo.address && state.tokenInfo.symbol !== 'ETH' && state.tokenInfo.symbol !== 'ERC20';
                if (isValidToken) {
                    try {
                        const a = await computeApproval();
                        if (gen !== summaryGeneration) return; // superseded by a newer refresh
                        applyApprovalUI(a);
                        isReady = !a.needsApproval;
                    } catch (e) {
                        if (gen !== summaryGeneration) return;
                        console.error('Approval check error:', e);
                        showNotification(`Failed to check token allowance: ${describeError(e, { action: 'allowance check' })}`, 'error');
                        isReady = false;
                    }
                } else {
                    isReady = false;
                    if (erc20Address.value.length > 0) {
                        showNotification('Enter a valid ERC-20 contract address to proceed.', 'error');
                    }
                }
            } else {
                isReady = true;
                approvalSection.classList.add('hidden');
            }

            // Burn address guard: block dispatch unless the user explicitly confirms.
            if (findBurnRecipients(state.recipients, BURN_ADDRESSES).length > 0 && !burnConfirmCheckbox.checked) {
                isReady = false;
            }

            // Safety cap on batch size.
            if (count > MAX_RECIPIENTS) {
                isReady = false;
            }
        }

        if (gen !== summaryGeneration) return; // stale result; a newer refresh won

        dispatchBtn.disabled = !isReady;
        if (isReady && count > 0) {
            updateStepIndicator(3);
        } else if (state.isWalletConnected) {
            updateStepIndicator(2);
        } else {
            updateStepIndicator(1);
        }
    }

    function updatePreview() {
        const dataPreview = document.getElementById('dataPreview');
        const previewTableBody = document.getElementById('previewTableBody');
        const previewFooter = document.getElementById('previewFooter');

        previewTableBody.innerHTML = '';

        if (state.recipients.length > 0) {
            dataPreview.classList.remove('hidden');
            const previewData = state.recipients.slice(0, 5);
            previewData.forEach(item => {
                const row = document.createElement('tr');
                const truncatedAddress = `${item.address.slice(0, 6)}...${item.address.slice(-4)}`;
                const decimals = state.tokenInfo.decimals || 18;
                const displayDecimals = Math.min(decimals, 8);
                const formattedAmount = parseFloat(item.amount).toFixed(displayDecimals);
                row.innerHTML = `<td class="p-1 font-mono">${truncatedAddress}</td><td class="p-1 font-mono text-right">${formattedAmount}</td>`;
                previewTableBody.appendChild(row);
            });

            if (state.recipients.length > 5) {
                previewFooter.classList.remove('hidden');
                previewFooter.textContent = `... and ${state.recipients.length - 5} more recipients.`;
            } else {
                previewFooter.classList.add('hidden');
            }
        } else {
            dataPreview.classList.add('hidden');
            previewFooter.classList.add('hidden');
        }
    }

    document.getElementById('exportListBtn').addEventListener('click', (e) => {
        e.preventDefault();
        if (state.recipients.length === 0) {
            showNotification('No recipients to export.', 'error');
            return;
        }
        const csvContent = 'Address,Amount\n' + state.recipients.map(r => `${r.address},${r.amount}`).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'farsend-recipients.csv';
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Recipients exported as CSV.', 'success');
    });

    // --- EVENT LISTENERS ---

    // Debounced chain switch to prevent race conditions
    let chainSwitchTimeout;
    chainSelector.addEventListener('change', async (e) => {
        const selectedChainId = parseInt(e.target.value);
        console.log('Chain selector changed to:', selectedChainId, 'Current wallet connected:', state.isWalletConnected);
        if (!selectedChainId || !state.isWalletConnected || !state.eip1193Provider) return;

        // Clear any pending switch
        if (chainSwitchTimeout) clearTimeout(chainSwitchTimeout);

        // Prevent duplicate updates
        if (state.currentChain?.chainId === selectedChainId) {
            console.log('Already on this chain');
            return;
        }

        if (!CHAINS_CONFIG[selectedChainId]) {
            showNotification('Selected chain is not supported', 'error');
            chainSelector.value = state.currentChain ? state.currentChain.chainId.toString() : '';
            return;
        }

        chainSwitchTimeout = setTimeout(async () => {
            try {
                const chainData = CHAINS_CONFIG[selectedChainId];

                // Prepare chain data for wallet_addEthereumChain
                const addChainParams = {
                    chainId: `0x${selectedChainId.toString(16)}`, // Convert to hex
                    chainName: chainData.name,
                    nativeCurrency: {
                        name: chainData.nativeCurrency?.name || 'Ethereum',
                        symbol: chainData.nativeCurrency?.symbol || 'ETH',
                        decimals: chainData.nativeCurrency?.decimals || 18
                    },
                    rpcUrls: [chainData.rpcUrl],
                    blockExplorerUrls: [chainData.explorerUrl]
                };

                // Try to switch using wallet_switchEthereumChain first
                try {
                    console.log('Attempting to switch to chainId:', selectedChainId);
                    await state.eip1193Provider.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: `0x${selectedChainId.toString(16)}` }]
                    });

                    // Wait briefly for the switch to process
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Verify the switch worked
                    const network = await state.provider.getNetwork();
                    if (Number(network.chainId) === selectedChainId) {
                        showNotification(`Successfully switched to ${chainData.name}`, 'success');
                        return;
                    }
                } catch (switchError) {
                    // If chain is not added to wallet, try adding it
                    if (switchError.code === 4902) { // Unrecognized chain ID
                        console.log('Chain not found in wallet, attempting to add it...');
                        try {
                            await state.eip1193Provider.request({
                                method: 'wallet_addEthereumChain',
                                params: [addChainParams]
                            });

                            // Wait for the chain to be added
                            await new Promise(resolve => setTimeout(resolve, 1000));

                            // Now try to switch again
                            await state.eip1193Provider.request({
                                method: 'wallet_switchEthereumChain',
                                params: [{ chainId: `0x${selectedChainId.toString(16)}` }]
                            });

                            // Wait briefly for the switch to process
                            await new Promise(resolve => setTimeout(resolve, 500));

                            // Verify the switch worked
                            const network = await state.provider.getNetwork();
                            if (Number(network.chainId) === selectedChainId) {
                                showNotification(`Successfully added and switched to ${chainData.name}`, 'success');
                                return;
                            }
                        } catch (addError) {
                            console.error('Failed to add chain:', addError);
                            throw addError;
                        }
                    } else {
                        throw switchError;
                    }
                }
            } catch (error) {
                console.error('Network switch failed:', error);

                let errorMessage = 'Failed to switch network.';
                if (error.code === 4001) {
                    errorMessage = 'Network switch rejected by user.';
                } else if (error.code === 4902) {
                    errorMessage = 'Chain not available in wallet and failed to add.';
                } else if (error.message) {
                    errorMessage = error.message;
                }

                showNotification(errorMessage, 'error');

                // Reset dropdown to current chain
                if (state.currentChain) {
                    chainSelector.value = state.currentChain.chainId.toString();
                }
            }
        }, 300); // Debounce
    });

    connectWalletBtn.addEventListener('click', handleConnectClick);
    baseAccountBtn.addEventListener('click', handleBaseAccountConnect);
    approveBtn.addEventListener('click', handleApprove);
    dispatchBtn.addEventListener('click', handleDispatch);

    burnConfirmCheckbox.addEventListener('change', () => {
        state.burnConfirmed = burnConfirmCheckbox.checked;
        updateSummary();
    });

    tokenSelect.addEventListener('change', () => {
        tokenSelect.classList.add('animate-bounce');
        setTimeout(() => tokenSelect.classList.remove('animate-bounce'), 400);
        state.token = tokenSelect.value;
        if (state.token === 'ERC20') {
            erc20InputContainer.classList.remove('hidden');
            tokenSymbolDisplay.textContent = 'Enter Address';
            tokenInfoRow.classList.add('hidden');
            approvalSection.classList.add('hidden');
            state.tokenInfo = { address: '', symbol: 'ERC20', decimals: 18, contract: null, allowance: 0n, requiredAllowance: 0n };
        } else {
            erc20InputContainer.classList.add('hidden');
            erc20Address.value = '';
            tokenSymbolDisplay.textContent = '';
            tokenInfoRow.classList.add('hidden');
            approvalSection.classList.add('hidden');
            const symbol = state.currentChain?.nativeCurrency?.symbol || 'ETH';
            const decimals = state.currentChain?.nativeCurrency?.decimals || 18;
            state.tokenInfo = { address: '', symbol: symbol, decimals: decimals, contract: null, allowance: 0n, requiredAllowance: 0n };

            // Update the dropdown option text
            const nativeOption = Array.from(tokenSelect.options).find(opt => opt.value === 'ETH');
            if (nativeOption) {
                nativeOption.textContent = symbol;
            }
        }
        parseAndValidateData(recipientsTextarea.value, 'text');
    });

    // Debounce high-frequency input. The token-contract check and the
    // parse+summary pipeline both do live RPC (symbol/decimals/allowance), so we
    // wait for a pause in typing instead of firing on every keystroke.
    const scheduleErc20Check = debounce(async (address) => {
        if (ethers.isAddress(address)) {
            await validateERC20Address(address);
        } else {
            tokenSymbolDisplay.textContent = 'Invalid';
            tokenInfoRow.classList.add('hidden');
            approvalSection.classList.add('hidden');
            state.tokenInfo = { address: '', symbol: 'ERC20', decimals: 18, contract: null, allowance: 0n, requiredAllowance: 0n };
        }
        await updateSummary();
    }, 300);

    const scheduleRecipientParse = debounce((value) => parseAndValidateData(value, 'text'), 250);

    erc20Address.addEventListener('input', (e) => scheduleErc20Check(e.target.value.trim()));

    recipientsTextarea.addEventListener('input', () => scheduleRecipientParse(recipientsTextarea.value));

    applyBulkAmountBtn.addEventListener('click', () => {
        const amount = bulkAmountInput.value.trim();
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            showNotification('Please enter a valid amount to apply to all addresses.', 'error');
            return;
        }

        const { lines: updatedLines, addressesFound } = applyFixedAmount(
            recipientsTextarea.value.split('\n'),
            amount
        );

        if (addressesFound === 0) {
            showNotification('No valid addresses found to apply the amount to. Paste addresses first.', 'error');
            return;
        }

        recipientsTextarea.value = updatedLines.join('\n');
        parseAndValidateData(recipientsTextarea.value, 'text');
        showNotification(`Applied ${amount} to ${addressesFound} addresses.`, 'success');

        // Visual feedback
        applyBulkAmountBtn.classList.add('bg-green-600');
        setTimeout(() => applyBulkAmountBtn.classList.remove('bg-green-600'), 1000);
    });

    // --- Distribution Mode Switching ---
    setFixedModeBtn.addEventListener('click', () => {
        fixedModePanel.classList.remove('hidden');
        randomModePanel.classList.add('hidden');
        setFixedModeBtn.className = 'text-[10px] font-bold px-3 py-1 rounded-md transition-all bg-white text-purple-600 shadow-sm';
        setRandomModeBtn.className = 'text-[10px] font-bold px-3 py-1 rounded-md transition-all text-gray-500 hover:text-gray-700';
    });

    setRandomModeBtn.addEventListener('click', () => {
        randomModePanel.classList.remove('hidden');
        fixedModePanel.classList.add('hidden');
        setRandomModeBtn.className = 'text-[10px] font-bold px-3 py-1 rounded-md transition-all bg-white text-purple-600 shadow-sm';
        setFixedModeBtn.className = 'text-[10px] font-bold px-3 py-1 rounded-md transition-all text-gray-500 hover:text-gray-700';
    });

    // --- Random Distribution Logic ---
    applyRandomAmountBtn.addEventListener('click', () => {
        const totalBudget = parseFloat(randomTotalInput.value);
        const minVal = parseFloat(randomMinInput.value);
        const maxVal = parseFloat(randomMaxInput.value);

        if (isNaN(totalBudget) || totalBudget <= 0) return showNotification('Please enter a valid total budget.', 'error');
        if (isNaN(minVal) || minVal < 0) return showNotification('Please enter a valid min amount.', 'error');
        if (isNaN(maxVal) || maxVal <= minVal) return showNotification('Max must be greater than min.', 'error');

        const addresses = extractAddresses(recipientsTextarea.value.split('\n'));
        if (addresses.length === 0) return showNotification('No addresses found. Please paste addresses first.', 'error');

        // Check if minimum distribution is even possible
        if (addresses.length * minVal > totalBudget) {
            return showNotification(`Insufficient budget! Giving ${minVal} to ${addresses.length} wallets requires ${addresses.length * minVal}.`, 'error');
        }

        const { lines: updatedLines, runningTotal } = generateRandomDistribution(addresses, {
            totalBudget,
            minVal,
            maxVal,
            decimals: state.tokenInfo.decimals || 18
        });

        recipientsTextarea.value = updatedLines.join('\n');
        parseAndValidateData(recipientsTextarea.value, 'text');
        showNotification(`Generated random distribution. Total used: ${runningTotal.toFixed(4)} ${state.tokenInfo.symbol}`, 'success');

        // Visual feedback
        applyRandomAmountBtn.classList.add('bg-green-600');
        setTimeout(() => applyRandomAmountBtn.classList.remove('bg-green-600'), 1000);
    });

    csvUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            recipientsTextarea.value = e.target.result;
            let fileType = 'text';
            if (file.name.endsWith('.csv')) { fileType = 'text'; }
            else if (file.name.endsWith('.json')) { fileType = 'json'; }
            parseAndValidateData(e.target.result, fileType);
        };
        reader.readAsText(file);
        event.target.value = null;
    });

    // Periodic chain check to catch network switches with faster detection
    let chainCheckInterval;

    function startChainCheck() {
        if (chainCheckInterval) clearInterval(chainCheckInterval);
        chainCheckInterval = setInterval(async () => {
            if (state.isWalletConnected && state.provider && state.eip1193Provider) {
                try {
                    const network = await state.provider.getNetwork();
                    const currentChainId = Number(network.chainId);

                    // If chain changed without event firing
                    if (state.currentChain && state.currentChain.chainId !== currentChainId) {
                        console.log('Detected chain change via polling:', currentChainId, 'Previous was:', state.currentChain.chainId);

                        // Update provider to refresh connection using stored provider reference
                        if (state.eip1193Provider) {
                            const ethersProvider = new ethers.BrowserProvider(state.eip1193Provider);
                            state.provider = ethersProvider;
                            state.signer = await ethersProvider.getSigner();
                        }

                        updateChainDisplay(currentChainId);
                        showNotification(`Network switched to ${state.currentChain?.name || 'unknown chain'}`, 'info');
                    }
                } catch (error) {
                    console.error('Chain check failed:', error);
                }
            }
        }, 1500); // Check every 1.5 seconds (faster detection)
    }

    function stopChainCheck() {
        if (chainCheckInterval) {
            clearInterval(chainCheckInterval);
            chainCheckInterval = null;
        }
    }

    // --- APP-WIDE PROVIDER SUBSCRIBER ---
    window.appKit.subscribeProviders(async (providerState) => {
        const eip1193Provider = providerState['eip155'];

        try {
            if (!eip1193Provider) {
                if (state.isWalletConnected) {
                    showNotification('Wallet disconnected.', 'info');
                    handleDisconnect();
                } else {
                    connectWalletBtn.innerHTML = `
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                    <span>Connect Wallet</span>`;
                    connectWalletBtn.disabled = false;
                }
                return;
            }

            // Store provider reference
            state.eip1193Provider = eip1193Provider;

            const ethersProvider = new ethers.BrowserProvider(eip1193Provider);
            const signer = await ethersProvider.getSigner();
            const address = await signer.getAddress();
            const network = await ethersProvider.getNetwork();
            const chainId = Number(network.chainId);

            // Check if chain is supported
            if (!CHAINS_CONFIG[chainId]) {
                showNotification('Unsupported network. Please switch to a supported chain.', 'error');
                chainSelector.value = ''; // Reset dropdown
                state.currentChain = null;
                state.batchContract = null;
                dispatchBtn.disabled = true;
                return;
            }

            // Update chain display and contract
            console.log('Initial connection - updating chain display for chainId:', chainId);
            updateChainDisplay(chainId);

            const isNewConnection = !state.isWalletConnected;
            const isAccountChange = state.isWalletConnected && address.toLowerCase() !== state.walletAddress?.toLowerCase();

            if (isNewConnection || isAccountChange) {
                if (isAccountChange) {
                    showNotification('Wallet account changed.', 'info');
                }

                state.walletAddress = ethers.getAddress(address);
                state.provider = ethersProvider;
                state.signer = signer;

                // Update chain display and contract
                updateChainDisplay(chainId);

                state.isWalletConnected = true;
                const truncatedAddress = `${state.walletAddress.slice(0, 6)}...${state.walletAddress.slice(-4)}`;

                connectWalletBtn.innerHTML = `<span>Connected: ${truncatedAddress}</span>`;
                connectWalletBtn.classList.remove('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700', 'bg-red-500', 'hover:bg-red-600');
                connectWalletBtn.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
                connectWalletBtn.disabled = false;

                appContent.classList.remove('hidden');
                updateStepIndicator(2);

                // Enable chain selector when connected
                chainSelector.disabled = false;

                if (isNewConnection) {
                    showNotification(`Wallet connected on ${state.currentChain?.name || 'network'}: ${truncatedAddress}`, 'success');
                    startChainCheck(); // Start monitoring chain changes
                }

                if (state.token === 'ERC20' && ethers.isAddress(erc20Address.value)) {
                    await validateERC20Address(erc20Address.value);
                }
                await updateSummary();

                // CRITICAL FIX: Only add listeners once
                if (!state.accountsChangedListenerAdded) {
                    state.accountsChangedListenerAdded = true;

                    // Listen for account changes
                    eip1193Provider.on('accountsChanged', async (accounts) => {
                        if (accounts.length === 0) {
                            showNotification('Wallet disconnected or no accounts available.', 'info');
                            handleDisconnect();
                            return;
                        }

                        const newAddress = ethers.getAddress(accounts[0]);
                        if (state.isWalletConnected && state.walletAddress && newAddress.toLowerCase() !== state.walletAddress.toLowerCase()) {
                            showNotification('Wallet account changed.', 'info');

                            // Update state with new account
                            state.walletAddress = newAddress;
                            const ethersProvider = new ethers.BrowserProvider(eip1193Provider);
                            state.signer = await ethersProvider.getSigner();

                            // Get current chain and update contract
                            const network = await ethersProvider.getNetwork();
                            const currentChainId = Number(network.chainId);
                            console.log('Account changed - updating chain display for chainId:', currentChainId);
                            updateChainDisplay(currentChainId);

                            // Update UI
                            const truncatedAddress = `${newAddress.slice(0, 6)}...${newAddress.slice(-4)}`;
                            connectWalletBtn.innerHTML = `<span>Connected: ${truncatedAddress}</span>`;
                            connectWalletBtn.classList.remove('bg-gray-200', 'hover:bg-gray-300', 'text-gray-700', 'bg-red-500', 'hover:bg-red-600');
                            connectWalletBtn.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
                            connectWalletBtn.disabled = false;

                            appContent.classList.remove('hidden');
                            updateStepIndicator(2);

                            // Re-validate ERC-20 token if applicable
                            if (state.token === 'ERC20' && ethers.isAddress(erc20Address.value)) {
                                await validateERC20Address(erc20Address.value);
                            }
                            await updateSummary();
                        }
                    });

                    // Listen for chain changes with locking to prevent race conditions
                    let isProcessingChainChange = false;

                    eip1193Provider.on('chainChanged', async (chainIdHex) => {
                        if (isProcessingChainChange) {
                            console.log('Chain change already in progress, skipping');
                            return;
                        }

                        isProcessingChainChange = true;

                        try {
                            const newChainId = Number(chainIdHex);
                            console.log('Chain changed event fired, newChainId:', newChainId, 'Hex was:', chainIdHex);

                            // Check if chain is supported
                            if (!CHAINS_CONFIG[newChainId]) {
                                console.log('Chain not supported:', newChainId);
                                showNotification(`Unsupported network (Chain ID: ${newChainId}). Please switch to a supported chain.`, 'error');
                                return;
                            }

                            console.log('Attempting to update provider and signer for new chain');

                            // Update provider and signer for new chain
                            const ethersProvider = new ethers.BrowserProvider(eip1193Provider);
                            state.provider = ethersProvider;

                            // Get the signer for the new chain
                            state.signer = await ethersProvider.getSigner();

                            // Update chain display and contract
                            updateChainDisplay(newChainId);

                            // Manually update the batchContract with the new chain's contract address
                            if (state.signer && CONTRACT_ABI && CHAINS_CONFIG[newChainId]) {
                                state.batchContract = new ethers.Contract(
                                    CHAINS_CONFIG[newChainId].contractAddress,
                                    CONTRACT_ABI,
                                    state.signer
                                );
                                console.log('Manually updated batchContract for chainId:', newChainId);
                            }

                            console.log('Successfully switched to chainId:', newChainId, 'Name:', state.currentChain?.name);
                            showNotification(`Switched to ${state.currentChain?.name || 'network'} (Chain ID: ${newChainId})`, 'success');

                            // Ensure dropdown reflects the actual current chain
                            if (state.currentChain) {
                                chainSelector.value = state.currentChain.chainId.toString();
                                console.log('Updated dropdown value to:', chainSelector.value);
                            }

                            // Re-validate ERC-20 token if applicable
                            if (state.token === 'ERC20' && ethers.isAddress(erc20Address.value)) {
                                await validateERC20Address(erc20Address.value);
                            }
                            await updateSummary();

                            // Force update the UI elements to reflect the new chain
                            if (state.currentChain) {
                                console.log('Chain switch complete, UI updated for:', state.currentChain.name);
                            }
                        } catch (error) {
                            console.error('Chain change error:', error);
                            showNotification(`Failed to switch network: ${error.message}`, 'error');
                        } finally {
                            isProcessingChainChange = false;
                        }
                    });
                }
            }

        } catch (error) {
            console.error('Subscriber error:', error);
            showNotification(`Connection failed: ${error.message.substring(0, 100)}`, 'error');
            handleDisconnect();
            connectWalletBtn.innerHTML = `
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            <span>Connect Wallet</span>`;
            connectWalletBtn.disabled = false;
        }
    });

    // --- INITIALIZATION ---
    updateStepIndicator(state.currentStep);

    // Check for existing connection on page load
    (async () => {
        try {
            // Wait a bit for AppKit to initialize
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get the wallet provider. The main subscribeProviders handler above
            // already listens for wallet state, so we only need to log the detected state.
            const eip1193Provider = await window.appKit.getWalletProvider();
            if (eip1193Provider) {
                console.log('Existing wallet provider detected on page load');
            } else {
                console.log('No existing provider found');
            }
        } catch (error) {
            console.log('No existing connection found:', error);
        }
    })();
}

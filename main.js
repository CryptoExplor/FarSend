// Import dependencies
import { ethers } from 'ethers';
import confetti from 'canvas-confetti';
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet, base, optimism, arbitrum, bsc, avalanche, polygon } from '@reown/appkit/networks';
import { sdk } from '@farcaster/miniapp-sdk';

// Initialize Farcaster SDK
sdk.actions.ready({ disableNativeGestures: true });

// Make confetti available globally
window.confetti = confetti;

// Initialize Reown AppKit
let appKit;

(async () => {
    try {
        appKit = await createAppKit({
            projectId: '0c80bc29a555c719ed2410c54b52a16d',
            networks: [base, mainnet, optimism, arbitrum, bsc, avalanche, polygon],
            adapters: [new EthersAdapter()],
            metadata: {
                name: 'FarSend',
                description: 'Multi-chain batch send ETH and ERC-20 tokens',
                url: 'https://farsend.vercel.app',
                icons: ['https://farsend.vercel.app/icon.png']
            },
            defaultNetwork: base,
            features: {
                socials: false,
                email: false
            },
            themeMode: 'dark'
        });

        window.appKit = appKit;
        console.log('✅ Reown AppKit initialized successfully');

        // Initialize the main app
        initializeApp();
    } catch (error) {
        console.error('❌ Failed to initialize AppKit:', error);
        document.getElementById('connectWalletBtn').innerHTML = '<span style="color: red;">Error: Failed to load wallet connector. Please refresh.</span>';
    }
})();

function initializeApp() {
    // --- CONSTANTS & CONFIGURATION ---

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
            setupEventListeners();
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
    const appContent = document.getElementById('app-content');
    const chainSelector = document.getElementById('chainSelector');
    const tokenSelect = document.getElementById('tokenSelect');
    const erc20InputContainer = document.getElementById('erc20InputContainer');
    const erc20Address = document.getElementById('erc20Address');
    const tokenSymbolDisplay = document.getElementById('tokenSymbolDisplay');
    const recipientsTextarea = document.getElementById('recipients');
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
    };

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

    function showNotification(message, type = 'success') {
        const icons = { success: '✅', error: '❌', info: '💡' };
        notification.innerHTML = `${icons[type] || ''} ${message}`;
        notification.className = 'p-4 rounded-lg text-sm main-card shadow-lg show';

        if (type === 'success') {
            notification.style.backgroundColor = '#d1fae5';
            notification.style.color = '#065f46';
            notification.style.border = '1px solid #34d399';
        } else if (type === 'error') {
            notification.style.backgroundColor = '#fee2e2';
            notification.style.color = '#991b1b';
            notification.style.border = '1px solid #f87171';
        } else {
            notification.style.backgroundColor = '#DBEAFE';
            notification.style.color = '#1E40AF';
            notification.style.border = '1px solid #93C5FD';
        }
        setTimeout(() => notification.classList.remove('show'), 8000);
    }

    function updateStepIndicator(step) {
        state.currentStep = step;
        const steps = [
            { id: 'stepCircle1', labelId: 'stepLabel1', label: 'Connect Wallet' },
            { id: 'stepCircle2', labelId: 'stepLabel2', label: 'Define Recipients' },
            { id: 'stepCircle3', labelId: 'stepLabel3', label: 'Dispatch' }
        ];

        steps.forEach((s, index) => {
            const stepEl = document.getElementById(s.id);
            const labelEl = document.getElementById(s.labelId);
            const isActive = (index + 1) === step;
            const isCompleted = (index + 1) < step;

            stepEl.className = 'w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300';
            labelEl.className = 'text-xs mt-2 text-center transition-colors duration-300';

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
            showNotification(`Wallet connection failed: ${error.message.substring(0, 100)}`, 'error');

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

    async function validateERC20Address(address) {
        if (!state.provider) {
            showNotification('Please connect your wallet first.', 'error');
            return false;
        }
        try {
            const tokenContract = new ethers.Contract(address, ERC20_ABI, state.provider);
            const [symbol, decimals] = await Promise.all([
                tokenContract.symbol(),
                tokenContract.decimals()
            ]);

            state.tokenInfo = {
                address: ethers.getAddress(address),
                symbol: symbol,
                decimals: Number(decimals),
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

    async function checkAndPromptApproval() {
        if (state.token !== 'ERC20' || !state.tokenInfo.contract || state.recipients.length === 0) return true;

        try {
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

            const allowance = await tokenContractWithSigner.allowance(state.walletAddress, state.currentChain?.contractAddress);

            state.tokenInfo.allowance = allowance;
            state.tokenInfo.requiredAllowance = totalAmountBN;

            if (allowance < totalAmountBN) {
                const requiredFormatted = ethers.formatUnits(totalAmountBN, decimals);
                const currentFormatted = ethers.formatUnits(allowance, decimals);
                approvalMessage.innerHTML = `To send a total of <strong>${requiredFormatted} ${state.tokenInfo.symbol}</strong>, approve spending. Your current allowance is ${currentFormatted} ${state.tokenInfo.symbol}.`;
                approveAmountEl.textContent = requiredFormatted;
                approveSymbolEl.textContent = state.tokenInfo.symbol;
                approvalSection.classList.remove('hidden');
                return false;
            } else {
                approvalSection.classList.add('hidden');
                return true;
            }
        } catch (error) {
            console.error('Approval check error:', error);
            showNotification(`Failed to check token allowance: ${error.message || 'Unknown error'}`, 'error');
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
            const msg = error.code === 'ACTION_REJECTED' ? 'Approval rejected by user.' : `Approval failed: ${error.message.substring(0, 100)}`;
            showNotification(msg, 'error');
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

            const decimals = token === 'ETH' ? 18 : tokenInfo.decimals;
            const amounts = recipients.map(r => {
                try {
                    return ethers.parseUnits(r.amount, decimals);
                } catch (e) {
                    throw new Error(`Invalid amount format: ${r.amount}`);
                }
            });
            const totalAmountBN = amounts.reduce((sum, amt) => sum + amt, 0n);

            if (token === 'ETH') {
                const balance = await state.provider.getBalance(walletAddress);
                if (totalAmountBN > balance) {
                    const required = ethers.formatEther(totalAmountBN);
                    const available = ethers.formatEther(balance);
                    throw new Error(`Insufficient ETH balance. Required: ${required} ETH, Available: ${available} ETH`);
                }
            } else {
                if (!tokenInfo.contract) throw new Error('Token contract not initialized');
                const tokenContractWithSigner = tokenInfo.contract.connect(signer);
                const contractAddress = state.currentChain?.contractAddress;
                const [balance, allowance] = await Promise.all([
                    tokenContractWithSigner.balanceOf(walletAddress),
                    tokenContractWithSigner.allowance(walletAddress, contractAddress)
                ]);

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
            const recipientAddresses = recipients.map(r => r.address);
            const explorerUrl = state.currentChain?.explorerUrl || 'https://etherscan.io';

            // CRITICAL FIX: Add explicit gas estimation and limits for Farcaster Wallet
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
                    // Fallback with manual gas limit
                    const fallbackGasLimit = 200000n + (BigInt(recipients.length) * 50000n);
                    tx = await batchContract.disperseEther(
                        recipientAddresses,
                        amounts,
                        {
                            value: totalValue,
                            gasLimit: fallbackGasLimit
                        }
                    );
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
                    // Fallback with manual gas limit
                    const fallbackGasLimit = 200000n + (BigInt(recipients.length) * 70000n);
                    tx = await batchContractWithSigner.disperseToken(
                        tokenInfo.address,
                        recipientAddresses,
                        amounts,
                        {
                            gasLimit: fallbackGasLimit
                        }
                    );
                }
            }

            showNotification(`Batch transaction sent! Waiting for confirmation: <a href="${explorerUrl}/tx/${tx.hash}" target="_blank" class="font-bold underline" style="color: #582FD6;">View Tx</a>`, 'info');

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                const explorerName = state.currentChain?.explorerUrl?.includes('basescan') ? 'BaseScan' :
                    state.currentChain?.explorerUrl?.includes('etherscan') ? 'Etherscan' :
                        state.currentChain?.explorerUrl?.includes('optimistic') ? 'Optimistic Etherscan' :
                            state.currentChain?.explorerUrl?.includes('arbiscan') ? 'Arbiscan' :
                                state.currentChain?.explorerUrl?.includes('bscscan') ? 'BscScan' :
                                    state.currentChain?.explorerUrl?.includes('snowtrace') ? 'Snowtrace' :
                                        state.currentChain?.explorerUrl?.includes('polygonscan') ? 'PolygonScan' : 'Explorer';
                const message = `✅ Success! Batch of ${recipients.length} transfers confirmed.<br>
                                <a href="${explorerUrl}/tx/${receipt.hash}" target="_blank" class="font-bold underline" style="color: #582FD6;">View on ${explorerName}</a>`;
                showNotification(message, 'success');

                if (window.confetti) {
                    window.confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                }

                recipientsTextarea.value = '';
                parseAndValidateData('', 'text');

            } else {
                throw new Error('Transaction reverted on chain. Please check BaseScan for details.');
            }

        } catch (error) {
            console.error('Dispatch error:', error);
            let reason = error.message || 'Unknown error';
            if (error.reason) {
                reason = error.reason;
            } else if (error.data) {
                try {
                    const hexData = error.data.startsWith('0x') ? error.data : '0x' + error.data;
                    const iface = new ethers.Interface(CONTRACT_ABI);
                    const decoded = iface.parseError(hexData);
                    if (decoded) {
                        reason = `${decoded.name}(${decoded.args.map(arg => arg.toString()).join(', ')})`;
                    } else {
                        const revertSelector = '0x08c379a0';
                        if (hexData.startsWith(revertSelector)) {
                            const stringData = hexData.slice(10);
                            reason = ethers.toUtf8String('0x' + stringData);
                        }
                    }
                } catch (decodeErr) {
                    console.error('Revert decode failed:', decodeErr);
                }
            } else if (error.error?.data) {
                try {
                    const data = error.error.data;
                    const hexData = data.startsWith('0x') ? data : '0x' + data.slice(2 || data);
                    const iface = new ethers.Interface(CONTRACT_ABI);
                    const decoded = iface.parseError(hexData);
                    if (decoded) {
                        reason = `${decoded.name}(${decoded.args.map(arg => arg.toString()).join(', ')})`;
                    } else if (hexData.startsWith('0x08c379a0')) {
                        const stringData = hexData.slice(10);
                        reason = ethers.toUtf8String('0x' + stringData);
                    }
                } catch (decodeErr) {
                    console.error('Revert decode failed:', decodeErr);
                }
            }
            const msg = error.code === 'ACTION_REJECTED' ? 'Transaction rejected by user.' : `Dispatch failed: ${reason}`;
            showNotification(msg, 'error');
        } finally {
            loadingSpinner.classList.add('hidden');
            dispatchBtnText.textContent = 'Dispatch Batch';
            document.getElementById('shieldIcon').classList.remove('hidden');
            await updateSummary();
        }
    }

    function parseAndValidateData(data, type = 'text') {
        let parsedData = [];
        let errorCount = 0;
        let isCSVHeader = false;

        if (type === 'json') {
            try {
                parsedData = JSON.parse(data);
                if (!Array.isArray(parsedData)) throw new Error("JSON is not an array");
                parsedData = parsedData.map(item => ({
                    address: item.address,
                    amount: item.amount.toString().trim()
                })).filter(item => item.address && typeof item.address === 'string' && !isNaN(parseFloat(item.amount)) && parseFloat(item.amount) > 0);
            } catch (e) {
                showNotification('Invalid JSON format. Expected array of {"address": "0x...", "amount": 1.23}.', 'error');
                return;
            }
        } else {
            const lines = data.trim().split('\n');
            if (lines.length > 0 && (lines[0].toLowerCase().includes('address') && lines[0].toLowerCase().includes('amount'))) {
                isCSVHeader = true;
            }
            const startLine = isCSVHeader ? 1 : 0;

            for (let i = startLine; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line === '') continue;

                const parts = line.split(/[\s,]+/).filter(p => p.trim());

                if (parts.length < 2) {
                    errorCount++;
                    continue;
                }

                let address = parts[0].trim();
                let amountStr = parts.slice(1).join(' ').trim().replace(/,/g, '');

                const amountNum = parseFloat(amountStr);
                if (address && !isNaN(amountNum) && amountNum > 0) {
                    parsedData.push({ address, amount: amountStr });
                } else {
                    errorCount++;
                }
            }
        }

        // Validate addresses and amounts
        const validRecipients = [];
        const decimals = state.token === 'ETH' ? 18 : state.tokenInfo.decimals;
        parsedData.forEach(item => {
            try {
                const validAddress = ethers.getAddress(item.address);
                // Validate amount doesn't exceed token decimals
                const decimalPart = item.amount.split('.')[1];
                if (decimalPart && decimalPart.length > decimals) {
                    throw new Error(`Amount ${item.amount} exceeds ${decimals} decimal places`);
                }
                validRecipients.push({ address: validAddress, amount: item.amount });
            } catch (e) {
                console.warn(`Invalid recipient: ${item.address}, ${item.amount} - ${e.message}`);
                errorCount++;
            }
        });

        state.recipients = validRecipients;

        if (errorCount > 0) {
            showNotification(`Parsed ${state.recipients.length} valid recipients. Ignored ${errorCount} invalid lines (check address format or amounts).`, 'info');
        } else if (state.recipients.length > 0) {
            showNotification(`${state.recipients.length} recipients loaded successfully.`, 'success');
        } else if (data.trim().length > 0) {
            showNotification('No valid recipients found in the data.', 'error');
        }

        updateSummary();
        updatePreview();
    }

    async function updateSummary() {
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
                    const isApproved = await checkAndPromptApproval();
                    isReady = isApproved;
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
        }

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

    // Populate and handle chain selector
    populateChainSelector();
    chainSelector.disabled = true; // Disabled until wallet connects

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
    approveBtn.addEventListener('click', handleApprove);
    dispatchBtn.addEventListener('click', handleDispatch);

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

    erc20Address.addEventListener('input', async (e) => {
        const address = e.target.value.trim();
        if (ethers.isAddress(address)) {
            await validateERC20Address(address);
        } else {
            tokenSymbolDisplay.textContent = 'Invalid';
            tokenInfoRow.classList.add('hidden');
            approvalSection.classList.add('hidden');
            state.tokenInfo = { address: '', symbol: 'ERC20', decimals: 18, contract: null, allowance: 0n, requiredAllowance: 0n };
        }
        await updateSummary();
    });

    recipientsTextarea.addEventListener('input', () => parseAndValidateData(recipientsTextarea.value, 'text'));

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
                    } else {
                        // Log when no change is detected for debugging
                        console.log('Polling: no chain change detected, still on:', currentChainId);
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
            await new Promise(resolve => setTimeout(resolve, 500));

            const initialState = window.appKit.getState();
            const eip1193Provider = initialState?.providerType === 'injected' || initialState?.providerType === 'walletConnect'
                ? await window.appKit.getWalletProvider()
                : null;

            if (eip1193Provider) {
                console.log('Found existing connection on page load');
                // Trigger the provider subscriber manually
                window.appKit.subscribeProviders(() => { });
            }
        } catch (error) {
            console.log('No existing connection found:', error);
        }
    })();
}

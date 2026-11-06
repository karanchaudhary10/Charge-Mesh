import { HashConnect } from "hashconnect";
import { LedgerId } from "@hashgraph/sdk";
import { WalletConnectModal } from "@walletconnect/modal";
import { currentTheme } from "./lib/theme.js";

/**
 * HashConnect opens a WalletConnect pairing client. Creating a new instance on
 * every render/visit stacks sessions and can make HashPack prompt repeatedly,
 * so keep one instance per portal for the lifetime of the tab.
 */
const instances = new Map<string, HashConnect>();
const pending = new Map<string, Promise<HashConnect>>();

export function getHashConnect(key: string, description: string): Promise<HashConnect> {
  const existing = instances.get(key);
  if (existing) return Promise.resolve(existing);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const projectId = import.meta.env.VITE_HASHCONNECT_PROJECT_ID?.trim();
  if (!projectId || projectId === "YOUR_WALLETCONNECT_PROJECT_ID") {
    return Promise.reject(
      new Error("HashPack is not configured. Set VITE_HASHCONNECT_PROJECT_ID in apps/web/.env.local.")
    );
  }

  const connection = (async () => {
    const hashconnect = new HashConnect(
      LedgerId.TESTNET,
      projectId,
      {
        name: "ChargeMesh",
        description,
        icons: ["https://www.hashpack.app/img/logo.svg"],
        url: window.location.origin
      },
      false
    );
    await hashconnect.init();
    instances.set(key, hashconnect);
    return hashconnect;
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, connection);
  return connection;
}

const HEDERA_CHAIN = "hedera:testnet";
const HASHPACK_UNIVERSAL_URL = "https://link.hashpack.app";
const HASHPACK_NATIVE_URL = "hashpack://";
const HASHPACK_IMAGE_ID = "8d55dd5a-7c9f-4929-d2d1-00564e41ac00";

let pairingModal: WalletConnectModal | null = null;

function hashPackProjectId(): string {
  const projectId = import.meta.env.VITE_HASHCONNECT_PROJECT_ID?.trim();
  if (!projectId || projectId === "YOUR_WALLETCONNECT_PROJECT_ID") {
    throw new Error(
      "HashPack is not configured. Set VITE_HASHCONNECT_PROJECT_ID in apps/web/.env.local."
    );
  }
  return projectId;
}

function getPairingModal(): WalletConnectModal {
  if (pairingModal) return pairingModal;

  const projectId = hashPackProjectId();
  pairingModal = new WalletConnectModal({
    projectId,
    chains: [HEDERA_CHAIN],
    // HashConnect 3.0.14 passes an empty wallet list to its own WalletConnect
    // modal, which leaves only a bare QR code. Render HashPack explicitly so
    // the pairing sheet always shows a wallet the renter can pick.
    enableExplorer: false,
    walletImages: {
      hashpack: `https://explorer-api.walletconnect.com/v3/logo/md/${HASHPACK_IMAGE_ID}?projectId=${projectId}`
    },
    desktopWallets: [
      {
        id: "hashpack",
        name: "HashPack",
        links: { native: "", universal: HASHPACK_UNIVERSAL_URL }
      }
    ],
    mobileWallets: [
      {
        id: "hashpack",
        name: "HashPack",
        links: { native: HASHPACK_NATIVE_URL, universal: HASHPACK_UNIVERSAL_URL }
      }
    ]
  });
  return pairingModal;
}

/**
 * Open a HashPack-first pairing sheet for a HashConnect session.
 *
 * HashPack's browser extension pairs over `window.postMessage`, so announce
 * the pairing URI before showing the modal: extension users get the approval
 * prompt right away, while everyone else can scan the QR code or open the
 * HashPack web wallet from the card in the sheet.
 */
export async function openHashPackPairing(hashconnect: HashConnect): Promise<void> {
  const uri = hashconnect.pairingString;
  if (!uri) {
    throw new Error("HashPack is still starting up. Refresh the page and try again.");
  }

  window.postMessage({ type: "hashconnect-connect-extension", pairingString: uri }, "*");
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      { type: "hashconnect2-iframe-pairing", pairingString: uri },
      "*"
    );
  }

  const modal = getPairingModal();
  modal.setTheme({ themeMode: currentTheme() });
  await modal.openModal({ uri, chains: [HEDERA_CHAIN] });
}

/** Dismiss the pairing sheet once a session is approved or abandoned. */
export function closeHashPackPairing(): void {
  pairingModal?.closeModal();
}

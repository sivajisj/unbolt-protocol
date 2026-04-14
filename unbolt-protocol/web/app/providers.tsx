'use client';

import { FC, ReactNode, useMemo, useEffect } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { clusterApiUrl } from '@solana/web3.js';

interface Props {
  children: ReactNode;
}

// Component to load CSS dynamically
function WalletStyles() {
  useEffect(() => {
    // Dynamically import CSS on client side only
    import('@solana/wallet-adapter-react-ui/styles.css');
  }, []);
  
  return null;
}

export const Providers: FC<Props> = ({ children }) => {
  const endpoint = useMemo(() => {
    // Use local validator if available, fallback to devnet
    if (process.env.NEXT_PUBLIC_RPC_ENDPOINT) {
      return process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    }
    return clusterApiUrl('devnet');
  }, []);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new BackpackWalletAdapter()],
    []
  );

  return (
    <>
      <WalletStyles />
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </>
  );
};
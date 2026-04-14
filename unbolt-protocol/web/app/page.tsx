'use client';

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Unbolt Protocol
          </h1>
          <WalletMultiButton />
        </div>
        
        <Dashboard />
      </div>
    </main>
  );
}
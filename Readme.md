
-----

# 🔓 Unbolt Protocol: Programmable Liquidity for the Global Workforce

[](https://opensource.org/licenses/MIT)
[](https://www.google.com/search?q=https://colosseum.org.in/)
[](https://solana.com/)

**Unbolt** is a high-performance PayFi protocol that transforms real-time income streams into instant on-chain liquidity. Built on Solana, it allows freelancers and contractors to bypass the 30-day "batch" payment cycle by using their already-earned, streaming income as collateral for instant, low-interest micro-loans.

-----

## 🚀 The Vision

In 2026, labor is instant, but capital is delayed. Unbolt bridges this gap by making "Time" programmable. By leveraging **Solana Token Extensions**, we ensure that credit is as fluid as the work that generates it.

-----

## ✨ Key Features

  * **Real-Time Streaming:** Seamlessly stream USDC (Token-2022) payments to workers second-by-second.
  * **Credit-over-Stream:** Use active, incoming payroll streams as collateral for instant liquidity.
  * **Automated Repayment:** Leveraging **Transfer Hooks** to intercept incoming stream funds for trustless loan settlement.
  * **Solana Blinks Integration:** Start or claim a payroll stream directly from social media or X (Twitter) with a single click.
  * **AI-Liquidity Agent:** An autonomous assistant (built on **elizaOS**) that optimizes borrowing based on stream velocity and market volatility.

-----

## 🏗️ Technical Architecture

Unbolt is architected for the **Internet Capital Markets** era:

  * **Smart Contracts:** Written in **Rust** using **Anchor 0.32.1**.
  * **Token Standard:** **SPL Token-2022** with **Transfer Hooks** for atomic repayment logic.
  * **Infrastructure:** **Helius LaserStream** for sub-second data indexing and **Pyth Network** for real-time LTV calculations.
  * **Frontend:** **Next.js 15 (App Router)** with **Solana Web3.js 2.0** for a modular, lightning-fast UI.

-----

## 🛠️ Quick Start

### 1\. Clone the Repository

```bash
git clone https://github.com/sivaji-gadidala-b712ba221/unbolt-protocol
cd unbolt-protocol
```

### 2\. Build the Anchor Program

```bash
cd program
anchor build
```

### 3\. Launch the Dashboard

```bash
cd app
npm install
npm run dev
```

-----

## 🛡️ Security

  * **Non-Custodial:** Funds are held in Program Derived Addresses (PDAs) with strictly defined authority.
  * **Over-Collateralized:** Loans are dynamically capped based on the total value and duration of the remaining stream.
  * **Auditing:** Drafted using the **Solana Developer MCP** for security best-practices and vulnerability scanning.

-----

## 👥 The Team

  * **[Sivaji Gadidala](https://linkedin.com/in/sivaji-gadidala-b712ba221/)** - Founding Protocol Engineer
  * **[Dheeraj Thota](https://www.linkedin.com/in/thotadheeraj/)** - Co-Founder & Head of Product

-----

## 📜 License

This project is licensed under the **MIT License**.



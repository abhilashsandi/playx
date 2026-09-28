// ============================================
// Mock Vendor Site - VendorA Quote Portal
// ============================================
// This is the website that Playwright automates against.
// It simulates a real vendor portal:
//   - Form with Name, Email, Quote ID fields
//   - Processing delay (1-3 seconds)
//   - 10% random failure rate
//   - Quote result display on success
//
// IMPORTANT: The HTML element IDs (#name, #email, #quoteId, #submit-btn,
// #result, #error) are used by Playwright selectors in VendorAAutomation.
// Do NOT change them without updating the automation code.
// ============================================

import React, { useState } from 'react';

interface FormData {
    name: string;
    email: string;
    quoteId: string;
}

function App() {
    const [formData, setFormData] = useState<FormData>({
        name: '',
        email: '',
        quoteId: '',
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsProcessing(true);
        setResult(null);
        setError(null);

        // Simulate processing delay (1-3 seconds)
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Simulate 10% random failure
        const shouldFail = Math.random() < 0.1;

        if (shouldFail) {
            setError('Processing failed: Internal vendor error. Please try again.');
            setIsProcessing(false);
            return;
        }

        // Generate mock quote result
        const quoteAmount = (Math.random() * 10000 + 500).toFixed(2);
        const resultText = `Quote Result: $${quoteAmount} for ${formData.name} (Ref: ${formData.quoteId})`;

        setResult(resultText);
        setIsProcessing(false);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.title}>🏢 VendorA Quote Portal</h1>
                <p style={styles.subtitle}>Submit your information to receive a quote</p>

                <form onSubmit={handleSubmit} style={styles.form}>
                    <div style={styles.field}>
                        <label htmlFor="name" style={styles.label}>Full Name</label>
                        <input
                            id="name"
                            name="name"
                            type="text"
                            required
                            value={formData.name}
                            onChange={handleChange}
                            style={styles.input}
                            placeholder="Enter your name"
                        />
                    </div>

                    <div style={styles.field}>
                        <label htmlFor="email" style={styles.label}>Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            value={formData.email}
                            onChange={handleChange}
                            style={styles.input}
                            placeholder="Enter your email"
                        />
                    </div>

                    <div style={styles.field}>
                        <label htmlFor="quoteId" style={styles.label}>Quote ID</label>
                        <input
                            id="quoteId"
                            name="quoteId"
                            type="text"
                            required
                            value={formData.quoteId}
                            onChange={handleChange}
                            style={styles.input}
                            placeholder="Enter quote reference"
                        />
                    </div>

                    <button
                        id="submit-btn"
                        type="submit"
                        disabled={isProcessing}
                        style={{
                            ...styles.button,
                            opacity: isProcessing ? 0.6 : 1,
                        }}
                    >
                        {isProcessing ? 'Processing...' : 'Get Quote'}
                    </button>
                </form>

                {/* Processing indicator */}
                {isProcessing && (
                    <div style={styles.processing}>
                        ⏳ Processing your request...
                    </div>
                )}

                {/* Success result — Playwright scrapes this element */}
                {result && (
                    <div id="result" style={styles.result}>
                        ✅ {result}
                    </div>
                )}

                {/* Error display — Playwright checks for this element */}
                {error && (
                    <div id="error" style={styles.error}>
                        ❌ {error}
                    </div>
                )}
            </div>
        </div>
    );
}

// Minimal embedded styles (no external CSS dependencies)
const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        padding: '20px',
    },
    card: {
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '40px',
        width: '100%',
        maxWidth: '480px',
        color: '#fff',
    },
    title: {
        margin: '0 0 8px 0',
        fontSize: '24px',
        fontWeight: '700',
    },
    subtitle: {
        margin: '0 0 32px 0',
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: '14px',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
    },
    field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    label: {
        fontSize: '13px',
        fontWeight: '500',
        color: 'rgba(255, 255, 255, 0.7)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    input: {
        padding: '12px 16px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        background: 'rgba(255, 255, 255, 0.05)',
        color: '#fff',
        fontSize: '15px',
        outline: 'none',
        transition: 'border-color 0.2s',
    },
    button: {
        padding: '14px',
        borderRadius: '8px',
        border: 'none',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: '#fff',
        fontSize: '15px',
        fontWeight: '600',
        cursor: 'pointer',
        marginTop: '8px',
        transition: 'opacity 0.2s',
    },
    processing: {
        marginTop: '20px',
        padding: '16px',
        borderRadius: '8px',
        background: 'rgba(102, 126, 234, 0.15)',
        border: '1px solid rgba(102, 126, 234, 0.3)',
        textAlign: 'center' as const,
        fontSize: '14px',
    },
    result: {
        marginTop: '20px',
        padding: '16px',
        borderRadius: '8px',
        background: 'rgba(34, 197, 94, 0.15)',
        border: '1px solid rgba(34, 197, 94, 0.3)',
        fontSize: '15px',
        fontWeight: '500',
    },
    error: {
        marginTop: '20px',
        padding: '16px',
        borderRadius: '8px',
        background: 'rgba(239, 68, 68, 0.15)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        fontSize: '14px',
    },
};

export default App;

// ============================================
// JobForm Component - Submit new automation jobs
// ============================================

import React, { useState } from 'react';
import { createJob, CreateJobPayload } from '../api/jobs';

interface Props {
    onJobCreated: (jobId: string) => void;
}

export function JobForm({ onJobCreated }: Props) {
    const [formData, setFormData] = useState<CreateJobPayload>({
        name: '',
        email: '',
        quoteId: '',
        vendor: 'VENDOR_A',
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const { jobId } = await createJob(formData);
            onJobCreated(jobId);
            // Reset form
            setFormData({ name: '', email: '', quoteId: '', vendor: 'VENDOR_A' });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create job');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    return (
        <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
                <label style={styles.label}>Name</label>
                <input
                    name="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    style={styles.input}
                    placeholder="Full name"
                />
            </div>

            <div style={styles.field}>
                <label style={styles.label}>Email</label>
                <input
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    style={styles.input}
                    placeholder="Email address"
                />
            </div>

            <div style={styles.field}>
                <label style={styles.label}>Quote ID</label>
                <input
                    name="quoteId"
                    type="text"
                    required
                    value={formData.quoteId}
                    onChange={handleChange}
                    style={styles.input}
                    placeholder="e.g. Q-12345"
                />
            </div>

            <div style={styles.field}>
                <label style={styles.label}>Vendor</label>
                <select
                    name="vendor"
                    value={formData.vendor}
                    onChange={handleChange}
                    style={styles.select}
                >
                    <option value="VENDOR_A">VendorA</option>
                    {/* Add new vendors here */}
                </select>
            </div>

            {error && <div style={styles.error}>❌ {error}</div>}

            <button
                type="submit"
                disabled={isSubmitting}
                style={{
                    ...styles.button,
                    opacity: isSubmitting ? 0.6 : 1,
                }}
            >
                {isSubmitting ? '⏳ Submitting...' : '🚀 Submit Job'}
            </button>
        </form>
    );
}

const styles: Record<string, React.CSSProperties> = {
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    label: {
        fontSize: '12px',
        fontWeight: '500',
        color: 'rgba(255, 255, 255, 0.6)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    input: {
        padding: '10px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        background: 'rgba(255, 255, 255, 0.05)',
        color: '#fff',
        fontSize: '14px',
        outline: 'none',
    },
    select: {
        padding: '10px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        background: 'rgba(255, 255, 255, 0.05)',
        color: '#fff',
        fontSize: '14px',
        outline: 'none',
    },
    button: {
        padding: '12px',
        borderRadius: '8px',
        border: 'none',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: '#fff',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        marginTop: '4px',
    },
    error: {
        padding: '10px',
        borderRadius: '8px',
        background: 'rgba(239, 68, 68, 0.15)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        fontSize: '13px',
        color: '#fca5a5',
    },
};

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function quote(input: string) {
    return `'${input.replace(/'/g, "'\\''")}'`;
}

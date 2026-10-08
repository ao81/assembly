global main
extern printf

section .data
	fmt db "answer = %d", 10, 0

section .text
main:
	push rbp
	mov rbp, rsp
	sub rsp, 32

	mov rax, 5
	; add rax, 3
	imul rax, 3

	lea rcx, [rel fmt]
	mov rdx, rax
	call printf

	add rsp, 32
	xor eax, eax
	pop rbp
	ret
global main
extern printf

section .data
	msg db "Hello, World!", 10, 0

section .text
main:
	push	rbp
	mov		rbp, rsp
	sub		rbp, rsp

	lea rcx, [rel msg]
	call printf

	add rsp, 32
	xor eax, eax
	pop rbp
	ret
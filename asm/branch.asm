global main
extern printf

section .data
	msg_big		db "%d は 10 以上です", 10, 0
	msg_small	db "%d は 10 より小さいです", 10, 0

section .text
main:
	push rbp
	mov rbp, rsp
	sub rsp, 32

	mov rax, 15
	cmp rax, 10
	jge is_big

	lea rcx, [rel msg_small]
	mov rdx, rax
	call printf
	jmp done

	is_big:
		lea rcx, [rel msg_big]
		mov rdx, rax
		call printf
	
	done:
		add rsp, 32
		xor eax, eax
		pop rbp
		ret
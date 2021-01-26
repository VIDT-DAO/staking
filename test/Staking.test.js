const Staking = artifacts.require('./Staking.sol');
const Deposits = artifacts.require('./Deposits.sol');
const ERC20 = artifacts.require('./ERC20Mock.sol');
const { waitUntilBlock } = require('./helpers/tempo')(web3);

contract('Staking', ([owner, alice, bob, carl]) => {
    before(async () => {
        this.erc20 = await ERC20.new("Mock token", "MOCK", 0, 1000000);
        let balance = await this.erc20.balanceOf(owner);
        assert.equal(balance.valueOf(), 1000000);
    });

    before(async () => {
        this.token1 = await ERC20.new("Token 1", "T1", 0, 0);

        await Promise.all([
            this.token1.mint(alice, 5000),
            this.token1.mint(bob, 500),
            this.token1.mint(carl, 2000),
        ]);

        const [balanceAlice, balanceBob, balanceCarl] = await Promise.all([
            this.token1.balanceOf(alice),
            this.token1.balanceOf(bob),
            this.token1.balanceOf(carl),
        ]);

        assert.equal(5000, balanceAlice);
        assert.equal(500, balanceBob);
        assert.equal(2000, balanceCarl);
    });

    before(async () => {
        this.token2 = await ERC20.new("Token 2", "T2", 0, 0);

        await Promise.all([
            this.token2.mint(alice, 1500),
            this.token2.mint(bob, 800),
        ]);

        const [balanceAlice, balanceBob, balanceCarl] = await Promise.all([
            this.token2.balanceOf(alice),
            this.token2.balanceOf(bob),
            this.token2.balanceOf(carl),
        ]);

        assert.equal(1500, balanceAlice);
        assert.equal(800, balanceBob);
        assert.equal(0, balanceCarl);
    });

    before(async () => {
        this.deposits = await Deposits.new();

        const currentBlock = await web3.eth.getBlockNumber();
        this.startBlock = currentBlock + 100;

        this.staking = await Staking.new(
            this.deposits.address,
            this.erc20.address,
            this.startBlock,
            this.startBlock + 1000,  // End block
            this.startBlock + 600    // Soft lock
        );

        await Promise.all([
            this.staking.add(this.token1.address, 1, 1000),
            this.staking.add(this.token2.address, 2, 500)
        ]);

        await this.erc20.approve(this.staking.address, 10000);
    });

    describe('when created', () => {
        it('is linked to the Mock ERC20 token', async () => {
            const linked = await this.staking.erc20();
            assert.equal(linked, this.erc20.address);
        });

        it('is configured with the correct start block, end block, and soft lock block', async () => {
            const startBlock = await this.staking.startBlock();
            const endBlock = await this.staking.endBlock();
            const softLockBlock = await this.staking.softLockBlock();

            assert.equal(startBlock, this.startBlock);
            assert.equal(endBlock, this.startBlock + 1000);
            assert.equal(softLockBlock, this.startBlock + 600);
        });

        it('is initialized for 2 token pools', async () => {
            const poolLength = await this.staking.poolLength();
            assert.equal(2, poolLength);

            const poolInfo1 = await this.staking.poolInfo(0);
            assert.equal(poolInfo1.token, this.token1.address);
            assert.equal(poolInfo1.rewardPerToken, 0.001e36);

            const poolInfo2 = await this.staking.poolInfo(1);
            assert.equal(poolInfo2.token, this.token2.address);
            assert.equal(poolInfo2.rewardPerToken, 0.004e36);
        });
    });

    describe('before the start block', () => {
        before(async () => {
            await Promise.all([
                this.token1.approve(this.deposits.address, 1500, {from: alice}),
                this.token1.approve(this.deposits.address, 500, {from: bob})
            ]);

            await Promise.all([
                this.deposits.deposit(this.token1.address, 1500, {from: alice}),
                this.deposits.deposit(this.token1.address, 500, {from: bob})
            ]);
        });

        it('does not assign any rewards yet', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(0, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(0, pendingBob);
        });
    })

    describe('after 10 blocks of staking', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 10);
        });

        it('has a pending reward for alice and bob', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(15, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(5, pendingBob);
        });
    });

    describe('with a 3th participant after 30 blocks', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 28);

            await this.token1.approve(this.deposits.address, 2000, {from: carl});
            await this.deposits.deposit(this.token1.address, 2000, {from: carl});
        });

        it('has a pending reward for alice and bob, but not yet for carl', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(45, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(15, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(0, pendingCarl);
        });
    });

    describe('after 50 blocks of staking', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 50);
        });

        it('has a pending reward for alice, bob, and carl', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(75, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(25, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(40, pendingCarl);
        });
    });

    describe('with a participant withdrawing after 70 blocks', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 69);
            await this.staking.withdraw({from: alice});
        });

        it('gives alice her deposit and reward', async () => {
            const balanceERC20 = await this.erc20.balanceOf(alice);
            assert.equal(75, balanceERC20);

            const balance1 = await this.token1.balanceOf(alice);
            assert.equal(5000, balance1);
        });

        it('has no deposit for alice', async () => {
            const deposited = await this.staking.deposited(0, alice);
            assert.equal(0, deposited);
        });

        it('has stored the amount that was paid out', async () => {
            const paidOut = await this.staking.paidOut();
            assert.equal(75, paidOut);
        });

        it('has taken the tokens from the contract owner', async () => {
            const balanceOwner = await this.erc20.balanceOf(owner);
            assert.equal(1000000 - 75, balanceOwner);
        });

        it('has a pending reward for bob and carl, but not for alice', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(0, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(35, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(140, pendingCarl);
        });
    });

/*
        describe('is safe', () => {
            it('won\'t allow alice to withdraw', async () => {
                try {
                    await this.staking.withdraw(0, 10, {from: alice});
                } catch (ex) {
                    assert.equal(ex.receipt.status, '0x0');
                    return;
                }
                assert.fail('withdraw successful');
            });

            it('won\'t allow carl to withdraw more than his deposit', async () => {
                const deposited = await this.staking.deposited(0, carl);
                assert.equal(500, deposited);

                try {
                    await this.staking.withdraw(0, 600, {from: carl});
                } catch (ex) {
                    assert.equal(ex.receipt.status, '0x0');
                    return;
                }
                assert.fail('withdraw successful');
            });

            it('won\'t allow alice to add an lp token to the pool', async () => {
                const deposited = await this.staking.deposited(0, carl);
                assert.equal(500, deposited);

                try {
                    await this.staking.withdraw(0, 600, {from: carl});
                } catch (ex) {
                    assert.equal(ex.receipt.status, '0x0');
                    return;
                }
                assert.fail('withdraw successful');
            });
        });

        describe('when it receives more funds (8000 MOCK)', () => {
            before(async () => {
                await this.erc20.approve(this.staking.address, 8000);
                await this.staking.fund(8000);
            });

            it('runs for 180 blocks (80 more)', async () => {
                const endBlock = await this.staking.endBlock();
                assert.equal(180, endBlock - this.startBlock);
            });
        });

        describe('with an added lp token (for 25%) after 100 blocks', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 99);
                this.staking.add(5, this.boost.address, true);
            });

            it('has a total reward of 3450 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(3450, totalPending);
            });

            it('is initialized for the LP token 2', async () => {
                const poolLength = await this.staking.poolLength();
                assert.equal(2, poolLength);

                const poolInfo = await this.staking.poolInfo(1);
                assert.equal(poolInfo[0], this.boost.address);
                assert.equal(poolInfo[1].words[0], 5);

                const totalAllocPoint = await this.staking.totalAllocPoint();
                assert.equal(totalAllocPoint, 20);
            });

            it('reserved nothing for alice, 2450 for bob, and 1000 for carl', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(2450, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(1000, pendingCarl);
            });
        });

        describe('with 1st participant for Boost after 110 blocks', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 108);

                await this.boost.approve(this.staking.address, 500, {from: carl});
                await this.staking.deposit(1, 500, {from: carl});
            });

            it('holds 1000 LP for the participants', async () => {
                const balanceStaking = await this.token1.balanceOf(this.staking.address);
                assert.equal(1000, balanceStaking);

                const depositAlice = await this.staking.deposited(0, alice);
                assert.equal(0, depositAlice);

                const depositBob = await this.staking.deposited(0, bob);
                assert.equal(500, depositBob);

                const depositCarl = await this.staking.deposited(0, carl);
                assert.equal(500, depositCarl);
            });

            it('holds 500 BST for the participants', async () => {
                const balanceStaking = await this.boost.balanceOf(this.staking.address);
                assert.equal(500, balanceStaking);

                const depositAlice = await this.staking.deposited(1, alice);
                assert.equal(0, depositAlice);

                const depositBob = await this.staking.deposited(1, bob);
                assert.equal(0, depositBob);

                const depositCarl = await this.staking.deposited(1, carl);
                assert.equal(500, depositCarl);
            });

            it('has a total reward of 4450 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(4450, totalPending);
            });

            it('reserved 75% for LP (50/50 bob/carl)', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(2825, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(1375, pendingCarl);
            });

            it('reserved 25% for BST (not rewarded) -> 250 MOCK inaccessible', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(1, bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(0, pendingCarl);
            });
        });

        describe('with 2nd participant for Boost after 120 blocks', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 118);

                await this.boost.approve(this.staking.address, 1000, {from: alice});
                await this.staking.deposit(1, 1000, {from: alice});
            });

            it('holds 1500 BST for the participants', async () => {
                const balanceStaking = await this.boost.balanceOf(this.staking.address);
                assert.equal(1500, balanceStaking);

                const depositAlice = await this.staking.deposited(1, alice);
                assert.equal(1000, depositAlice);

                const depositBob = await this.staking.deposited(1, bob);
                assert.equal(0, depositBob);

                const depositCarl = await this.staking.deposited(1, carl);
                assert.equal(500, depositCarl);
            });

            it('has a total reward of 5450 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(5450, totalPending);
            });

            it('reserved 75% for LP with 3200 for bob and 1750 for carl', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(3200, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(1750, pendingCarl);
            });

            it('reserved 25% for BST with 250 for carl', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(1, bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(250, pendingCarl);
            });
        });

        describe('after 140 blocks of staking', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 140);
            });

            it('has a total reward of 7450 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(7450, totalPending);
            });

            it('reserved 75% for LP with 3950 for bob and 2500 for carl', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(3950, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(2500, pendingCarl);
            });

            it('reserved 25% for BST with 333 for alice and 416 for carl', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(333, pendingAlice);

                const pendingBob = await this.staking.pending(1, bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(416, pendingCarl);
            });
        });

        describe('with a participant partially withdrawing BST after 150 blocks', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 149);
                await this.staking.withdraw(1, 200, {from: carl});
            });

            it('gives carl 500 MOCK and 200 LP', async () => {
                const balanceERC20 = await this.erc20.balanceOf(carl);
                assert.equal(3300, balanceERC20);

                const balance1 = await this.boost.balanceOf(carl);
                assert.equal(500, balance1);
            });

            it('has a total reward of 7950 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(7950, totalPending);
            });

            it('reserved 75% for LP with 4325 for bob and 2875 for carl', async () => {
                const pendingBob = await this.staking.pending(bob);
                assert.equal(4325, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(2875, pendingCarl);
            });

            it('reserved 25% for BST with 500 for alice and nothing for carl', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(500, pendingAlice);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(0, pendingCarl);
            });

            it('holds 1000 LP for the participants', async () => {
                const balanceStaking = await this.token1.balanceOf(this.staking.address);
                assert.equal(1000, balanceStaking);

                const depositBob = await this.staking.deposited(0, bob);
                assert.equal(500, depositBob);

                const depositCarl = await this.staking.deposited(0, carl);
                assert.equal(500, depositCarl);
            });

            it('holds 1300 BST for the participants', async () => {
                const balanceStaking = await this.boost.balanceOf(this.staking.address);
                assert.equal(1300, balanceStaking);

                const depositAlice = await this.staking.deposited(1, alice);
                assert.equal(1000, depositAlice);

                const depositCarl = await this.staking.deposited(1, carl);
                assert.equal(300, depositCarl);
            });
        });

        describe('with a participant doing an emergency withdraw BST after 160 blocks', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 159);
                await this.staking.emergencyWithdraw(1, {from: carl});
            });

            it('gives carl 500 LP', async () => {
                const balance1 = await this.boost.balanceOf(carl);
                assert.equal(800, balance1);
            });

            it('gives carl no MOCK', async () => {
                const balanceERC20 = await this.erc20.balanceOf(carl);
                assert.equal(3300, balanceERC20);
            });

            it('holds no BST for carl', async () => {
                const depositCarl = await this.staking.deposited(1, carl);
                assert.equal(0, depositCarl);
            });

            it('has no reward for carl', async () => {
                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(0, pendingCarl);
            });

            it('holds 1000 BST for alice', async () => {
                const balanceStaking = await this.boost.balanceOf(this.staking.address);
                assert.equal(1000, balanceStaking);

                const depositAlice = await this.staking.deposited(1, alice);
                assert.equal(1000, depositAlice);
            });

            it('has 750 MOCK pending for alice (receives bobs share)', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(750, pendingAlice);
            });
        });

        describe('when closed after 180 blocks', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 180);
            });

            it('has a total reward of 10950 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(10950, totalPending);
            });

            it('reserved 75% for LP with 4325 for bob and 2875 for carl', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(5450, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(4000, pendingCarl);
            });

            it('reserved 25% for BST with 1250 for alice', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(1250, pendingAlice);

                const pendingBob = await this.staking.pending(1, bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(0, pendingCarl);
            });
        });

        describe('when closed for 20 blocks (after 200 blocks)', () => {
            before(async () => {
                await waitUntilBlock(10, this.startBlock + 200);
            });

            it('still has a total reward of 10950 MOCK pending', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(10950, totalPending);
            });

            it('has a pending reward for LP 5450 for bob and 4000 for carl', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(5450, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(4000, pendingCarl);
            });

            it('has a pending reward for BST with 1250 for alice', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(1250, pendingAlice);

                const pendingBob = await this.staking.pending(1, bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(0, pendingCarl);
            });

            it('will not accept new funds', async () => {
                try {
                    await this.staking.fund(10000);
                } catch (ex) {
                    assert.equal(ex.receipt.status, '0x0');
                    return;
                }
                assert.fail('fund successful');
            });
        });

        describe('with participants withdrawing after closed', async () => {
            before(async () => {
                await this.staking.withdraw(1, 1000, {from: alice});
                await this.staking.withdraw(0, 500, {from: bob});
                await this.staking.withdraw(0, 500, {from: carl});
            });

            it('gives alice 1250 MOCK and 1000 BST', async () => {
                const balanceERC20 = await this.erc20.balanceOf(alice);
                assert.equal(5000, balanceERC20);

                const balance1 = await this.token1.balanceOf(alice);
                assert.equal(5000, balance1);

                const balanceBST = await this.boost.balanceOf(alice);
                assert.equal(1000, balanceBST);
            });

            it('gives carl 5450 MOCK and 500 LP', async () => {
                const balanceERC20 = await this.erc20.balanceOf(bob);
                assert.equal(5450, balanceERC20);

                const balance1 = await this.token1.balanceOf(bob);
                assert.equal(500, balance1);
            });

            it('gives carl 4000 MOCK and 500 LP', async () => {
                const balanceERC20 = await this.erc20.balanceOf(carl);
                assert.equal(7300, balanceERC20);

                const balance1 = await this.token1.balanceOf(carl);
                assert.equal(2000, balance1);

                const balanceBST = await this.boost.balanceOf(carl);
                assert.equal(800, balanceBST);
            });

            it('has an end balance of 250 MOCK, which is lost forever', async () => {
                const totalPending = await this.staking.totalPending();
                assert.equal(250, totalPending);

                const balanceStaking = await this.erc20.balanceOf(this.staking.address);
                assert.equal(250, balanceStaking);
            });

            it('has no pending reward for LP', async () => {
                const pendingAlice = await this.staking.pending(alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(carl);
                assert.equal(0, pendingCarl);
            });

            it('has no pending reward for BST', async () => {
                const pendingAlice = await this.staking.pending(1, alice);
                assert.equal(0, pendingAlice);

                const pendingBob = await this.staking.pending(1, bob);
                assert.equal(0, pendingBob);

                const pendingCarl = await this.staking.pending(1, carl);
                assert.equal(0, pendingCarl);
            });
        });

     */
});
